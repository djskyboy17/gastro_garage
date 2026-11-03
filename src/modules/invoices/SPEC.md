# Beszállítói számlák (Factură / Bon Fiscal) — v65

A Beszerzés „Számlák” lapja. Román Factură és Bon Fiscal fotóról vagy PDF-ről, AI-val (Google Gemini) kiolvasva vagy kézzel felvéve; átnézés és alapanyaghoz rendelés után **bevételezés a raktárba**.

## Határok
- A modul saját táblái: `supplier_invoices`, `supplier_invoice_lines`, `supplier_invoice_files`, `invoice_item_mappings`, `purchase_settings`.
- Bevételezéskor raktártételt (`stock_lots`) és raktármozgást (`stock_moves`, `kind = received`) hoz létre, ugyanúgy, mint a kézi bevételezés (`/api/operations/receive`); beszerzési rendeléshez nem kapcsolódik (`purchase_line_id = NULL`).
- Nincs: e-Factura XML import, NIR-dokumentum, könyvelési export, beszerzési rendeléshez párosítás, automatikus bevételezés. Az AI eredményét mindig embernek kell jóváhagynia.

## Folyamat
1. **Beolvasás** (`POST /api/invoices/scan {id, data?, ai}`): a böngésző a fotót legfeljebb 2200 px-re kicsinyíti (JPEG), a PDF változatlan. Fájl: JPEG / PNG / WebP / PDF, a típus a fájl első bájtjai alapján, legfeljebb 1,4 MB (az adatbázis-sor 2 MB-os korlátja miatt). `ai: true` esetén a szerver elküldi a Gemininek (`gemini-2.5-flash`, felülírható: `GEMINI_MODEL`), szigorú JSON-sémával; a választ Zod ellenőrzi és egységesíti (`normalizeExtraction`). A hívás a tranzakción kívül történik. A piszkozat (számla + fájl + sorok + napló) egy kötegben jön létre. Az `id` idempotenciakulcs: ismételt kérés nem hoz létre második számlát.
   - AI-hiba esetén (`INVOICE_AI_*`) semmi nem mentődik; a felület felajánlja a kézi felvitelt ugyanazzal a fájllal (`ai: false`). Kulcs nélkül (`GEMINI_API_KEY` hiányzik) csak kézi felvitel van.
2. **Átnézés** (`POST /api/invoices/save {id, revision, …fejléc, lines[]}`): minden mező javítható; a sorok cseréje, változat-ellenőrzéssel. Csak piszkozat módosítható.
3. **Bevételezés** (`POST /api/invoices/receive {id, revision, receivedDate}`): a szerver az adatbázisban tárolt sorokat ellenőrzi. Minden nem kihagyott sorhoz kell alapanyag, pozitív raktári mennyiség, lejárat (nem korábbi az átvételnél) és kiszámolható érték; az átvétel napja nem lehet jövőbeli. Egy kötegben: soronként raktártétel + mozgás, a sor `lot_id`-ja, a párosítás megjegyzése, a számla `received` állapota és a napló. Ha közben változott, semmi nem mentődik (`CONFLICT`); dupla bevételezés nem lehetséges.
4. **Elvetés** (`POST /api/invoices/discard`): csak piszkozat; a számla, a sorok és a fájl törlődik, a napló megmarad.

## Szabályok
- **Pénz** egész baniban; a számlamennyiség ezredekben (`invoice_quantity` 1250 = 1,25), a raktári mennyiség alapegységben (g / ml / db).
- **Román formátum:** egyetlen vessző mindig tizedesjel („12,5” = 12,50); „1.234,56” és „1,234.56” is értelmezett. Dátum: DD.MM.YYYY → YYYY-MM-DD. CUI/CIF: „RO” előtag megmarad, az ellenőrző számjegyet (kulcs 753217532) a felület jelzi, de nem tiltja.
- **Átváltás:** kg → g ×1000, l → ml ×1000, buc → db ×1; más esetben kézzel kell megadni. Alapanyag választásakor, ha egyértelmű, a raktári mennyiség magától kitöltődik.
- **Alapanyag-javaslat:** először a megjegyzett párosítás (szállító adószáma vagy neve + egységesített megnevezés → alapanyag és átváltás), utána a név szerinti egyezés; bizonytalan esetben nincs javaslat.
- **SGR-betét** (garanție SGR, 0,50 RON / palack): külön sor, alapból „nem raktári tétel”; sosem része az áru értékének. Az összegellenőrzés a betétet a végösszegben vagy külön sorként is elfogadja.
- **Bekerülési érték:** beállítás (`purchase_settings.cost_basis`): nettó (alapértelmezett) vagy bruttó. [ELLENŐRIZENDŐ] a könyvelővel, hogy a cég ÁFA-fizető-e. A bevételezett számlán a használt alap rögzül. Ha csak bruttó (vagy csak nettó) érték van, a másik a TVA-kulccsal számolódik.
- **Összegellenőrzés:** a sorok bruttó összege és a végösszeg eltérése (soronként 1 bani tűréssel) figyelmeztetés, nem tiltás.

## Jogosultság és adatvédelem
- Olvasás és írás: tulajdonos, admin, konyha, raktár (mint a Beszerzés). A bekerülési érték beállítása: tulajdonos, admin. A szerver minden végponton ellenőrzi.
- A számla fájlja csak ezeknek a szerepköröknek szolgálható ki, `nosniff` és `Cache-Control: private, no-store` fejléccel.
- A Gemini API-kulcs Cloudflare-titok (`npm run cf:gemini`), helyben `.dev.vars`; soha nem kerül a forráskódba, a böngészőbe vagy a hibaüzenetekbe. A számlaképek a feldolgozáshoz a Google-hoz kerülnek: fizetős kulcs ajánlott (az ingyenes szinten a Google tanításra használhatja az adatot).

## Ellenőrző példák
1. Fotó feltöltése AI-val → piszkozat a kiolvasott fejléccel és sorokkal; az SGR-sor „nem raktári”. Ugyanaz az `id` ismét → nincs második számla.
2. HTML-fájl „képként” → `INVOICE_FILE_FORMAT`. 1,4 MB-nál nagyobb PDF → `INVOICE_FILE_TOO_LARGE`. AI kulcs nélkül → `INVOICE_AI_DISABLED`, kézi felvitel lehetséges.
3. Bevételezés lejárat nélküli sorral → `INVOICE_LINE_EXPIRES`; jövőbeli átvételi nappal → `INVALID_DATES`; régi változattal → `CONFLICT`.
4. Factura: 2,5 kg csirke nettó 50,00 (11%) és 30 db tojás bruttó 33,30 (11%), nettó alapon → raktártételek 2500 g / 50,00 RON és 30 db / 30,00 RON; az SGR-sor nem kerül raktárba. Második bevételezés → `CONFLICT`. Bevételezett számla nem vethető el.
5. A következő számlán ugyanattól a szállítótól ugyanaz a megnevezés → a megjegyzett alapanyag és átváltás javaslatként jelenik meg.
6. Futár szerepkör: lista, beolvasás és fájl → 403.
