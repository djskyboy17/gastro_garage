# Beszállítói számlák (Factură / Bon Fiscal) — v65

A Beszerzés „Számlák” lapja. Román Factură és Bon Fiscal fotóról vagy PDF-ről, AI-val (Google Gemini) kiolvasva vagy kézzel felvéve; átnézés és alapanyaghoz rendelés után **bevételezés a raktárba**.

## Határok
- A modul saját táblái: `supplier_invoices`, `supplier_invoice_lines`, `supplier_invoice_files`, `invoice_item_mappings`, `purchase_settings`.
- Bevételezéskor raktártételt (`stock_lots`) és raktármozgást (`stock_moves`, `kind = received`) hoz létre, ugyanúgy, mint a kézi bevételezés (`/api/operations/receive`); beszerzési rendeléshez nem kapcsolódik (`purchase_line_id = NULL`).
- Nincs: e-Factura XML import, NIR-dokumentum, könyvelési export, beszerzési rendeléshez párosítás, automatikus bevételezés. Az AI eredményét mindig embernek kell jóváhagynia.

## Folyamat
1. **Beolvasás** (`POST /api/invoices/scan {id, data?, ai}`): a böngésző a fotót legfeljebb 2200 px-re kicsinyíti (JPEG), a PDF változatlan. Fájl: JPEG / PNG / WebP / PDF, a típus a fájl első bájtjai alapján, legfeljebb 1,4 MB (az adatbázis-sor 2 MB-os korlátja miatt). `ai: true` esetén a szerver elküldi a Gemininek (`gemini-3.8-flash` (v67; 404 esetén egyszer `gemini-flash-latest`), felülírható: `GEMINI_MODEL`), szigorú JSON-sémával; a választ Zod ellenőrzi és egységesíti (`normalizeExtraction`). A hívás a tranzakción kívül történik. A piszkozat (számla + fájl + sorok + napló) egy kötegben jön létre. Az `id` idempotenciakulcs: ismételt kérés nem hoz létre második számlát.
   - AI-hiba esetén (`INVOICE_AI_*`) semmi nem mentődik; a felület felajánlja a kézi felvitelt ugyanazzal a fájllal (`ai: false`). Kulcs nélkül (`GEMINI_API_KEY` hiányzik) csak kézi felvitel van.
2. **Átnézés** (`POST /api/invoices/save {id, revision, …fejléc, lines[]}`): minden mező javítható; a sorok cseréje, változat-ellenőrzéssel. Csak piszkozat módosítható.
3. **Bevételezés** (`POST /api/invoices/receive {id, revision, receivedDate}`): a szerver az adatbázisban tárolt sorokat ellenőrzi. Minden nem kihagyott sorhoz kell alapanyag, pozitív raktári mennyiség, lejárat (nem korábbi az átvételnél) és kiszámolható érték; az átvétel napja nem lehet jövőbeli. Egy kötegben: soronként raktártétel + mozgás, a sor `lot_id`-ja, a párosítás megjegyzése, a számla `received` állapota és a napló. Ha közben változott, semmi nem mentődik (`CONFLICT`); dupla bevételezés nem lehetséges.
4. **Elvetés** (`POST /api/invoices/discard`): csak piszkozat; a számla, a sorok és a fájl törlődik, a napló megmarad.

## Szabályok

- A számla besorolása `stock` vagy `expense`, a régi rekordok `stock` értékkel maradnak használhatók. A költségszámla véglegesítéséhez a szállító, bizonylatszám, dátum, RON végösszeg és eltérés esetén indoklás szükséges. A költségsorok készletmezőit a szerver üríti.
- A költség véglegesítése ugyanabban a kötegben naplózza a számla és sorai pillanatképét, elmenti a változtathatatlan költségbejegyzést és véglegesíti a számlát. NIR és raktármozgás a készletbeszerzésekhez készül.
- Költség helyesbítése csak adminnak, indokkal és rendezett kifizetésekkel lehetséges. Az eredeti bejegyzés megmarad, külön negatív korrekció készül a helyesbítés napjára. A számla javítható piszkozat lesz, de a korábbi költségbejegyzések miatt véglegesen nem törölhető. Párhuzamos vagy elavult kérésből nem lesz két aktív költségbejegyzés.

- A könyvelési profil alkalmazása után az új bevételezések bruttó bekerülési értéket használnak. A nettó visszaállítását és a profilalkalmazással párhuzamos nettó bevételezést adatbázis-trigger tiltja. A korábbi NIR-ek értéke a kiállításkori pillanatkép szerint marad.
- **Pénz** egész baniban; a számlamennyiség ezredekben (`invoice_quantity` 1250 = 1,25), a raktári mennyiség alapegységben (g / ml / db).
- **Román formátum:** egyetlen vessző mindig tizedesjel („12,5” = 12,50); „1.234,56” és „1,234.56” is értelmezett. Dátum: DD.MM.YYYY → YYYY-MM-DD. CUI/CIF: „RO” előtag megmarad, az ellenőrző számjegyet (kulcs 753217532) a felület jelzi, de nem tiltja.
- **Átváltás:** kg → g ×1000, l → ml ×1000, buc → db ×1; más esetben kézzel kell megadni. Alapanyag választásakor, ha egyértelmű, a raktári mennyiség magától kitöltődik.
- **Alapanyag-javaslat:** először a megjegyzett párosítás (szállító adószáma vagy neve + egységesített megnevezés → alapanyag és átváltás), utána a név szerinti egyezés; bizonytalan esetben nincs javaslat.
- **SGR-betét** (garanție SGR, 0,50 RON / palack): külön sor, alapból „nem raktári tétel”; sosem része az áru értékének. Az összegellenőrzés a betétet a végösszegben vagy külön sorként is elfogadja.
- **Bekerülési érték:** beállítás (`purchase_settings.cost_basis`): **bruttó (alapértelmezett, v83)** vagy nettó. A cég nem áfafizető (neplătitor de TVA, a tulajdonos megerősítette 2026-11-05-én): az ÁFA nem igényelhető vissza, ezért a raktárba a ténylegesen kifizetett, TVA-val együtt számolt érték kerül. Nettót csak áfafizető cég használjon. Az AI-olvasás mindig a nettó és a bruttó értéket és a kulcsot is rögzíti, így a választás nem veszít adatot. A bevételezett számlán a használt alap rögzül. Ha csak bruttó (vagy csak nettó) érték van, a másik a TVA-kulccsal számolódik.
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

## Gemini-hívás finomítása — v66–v70
- Modell: `gemini-3.8-flash` (a 2.5-ös Flash új felhasználóknak már nem elérhető). Alacsony gondolkodási szint (`thinkingLevel: "low"`); ha a modell nem ismeri, egyszer nélküle.
- Modellsor: beállított → `gemini-flash-latest` → `gemini-flash-lite-latest`; 404-nél azonnal, túlterhelésnél (500/503) egy újrapróbálás után a következő. Mind túlterhelt → `INVOICE_AI_BUSY`; időtúllépés → `INVOICE_AI_TIMEOUT`; nem létező modell → `INVOICE_AI_MODEL`.
- Időkeret összesen 40 másodperc (mért: egy számla kb. 5 mp alacsony gondolkodással).
- A Google hibakódja és üzenete, valamint a sikeres hívás ideje a Worker naplójába kerül (`wrangler tail`); a kulcs soha.
- A többsoros megnevezés egy sorba kerül (sortörés és többszörös szóköz → egy szóköz).

## Számla megerősítése és NIR — v72 (fejlesztési terv 1. fázis)
- **Duplikátum:** kulcs = szállító adószáma (RO nélkül) + széria + szám (csak betű/szám, nagybetű, a szám vezető nullái nélkül: 0099 = 99). Az átnézésnél figyelmeztetés, ha más számlán is szerepel; **bevételezéskor tiltás**, ha egy bevételezett számlán már szerepel (`INVOICE_DUPLICATE`).
- **Bevételezés feltételei:** szállító, CUI, szám, dátum és végösszeg kötelező (`INVOICE_HEADER_REQUIRED`); csak RON (`INVOICE_CURRENCY`); tűrés feletti összegeltérés csak indoklással (`INVOICE_TOTAL_MISMATCH`), az ok a számlán és a NIR-en is megmarad.
- **Fizetési határidő** (`due_date`) a fejlécben (a pénzügyi fázishoz).
- **Szállítótörzs:** bevételezéskor a számla a beszállítóhoz kötődik CUI szerint; ha nincs ilyen, a rendszer felveszi (név + CUI, megjegyzés: „Számlából felvéve”).
- **Átvett mennyiség** soronként (ha eltér a számlázottól): a raktárba az átvett mennyiség kerül, az érték arányosan; az eltérés a NIR-en látszik. 0 átvett → nincs raktártétel, de a NIR-en szerepel.
- **NIR** (`nir_documents`): a bevételezéssel egy kötegben, sorszámmal (NIR-ÉV-szám, a `documents` sorozatból). Pillanatkép: szállító, számla, bizottság (Beállítás: soronként egy név), értékelés (nettó/bruttó), sorok (számlázott / átvett / eltérés, egységár, érték, TVA, tétel, lejárat), összesen. Nyomtatás: `GET /api/invoices/nir?id=` – román HTML, böngészőből PDF. A saját cég neve még nincs rajta (cégadatok: számlázási fázis).
- **NIR sztornó** (`POST /api/invoices/reverse {id, revision, reason}`, csak admin): csak ha a bevételezett tételekből még semmi nem fogyott és nem volt leltárkorrekció (`INVOICE_LOTS_USED`). Egy kötegben: sztornó-NIR (új szám, negatív sorok, „STORNO la …”), az eredeti NIR „sztornózva”, a raktári tételek nullázva (`receipt_reversal` mozgás), a számla újra piszkozat (javítható, újra bevételezhető új NIR-rel).
- **Bizonylat nem törölhető:** NIR-rel rendelkező számla nem vethető el (`INVOICE_HAS_NIR`).
- Nem része: beszerzési rendeléshez párosítás (később), nem RON-os bevételezés árfolyammal.
