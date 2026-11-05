# Átadás egy másik AI-nak / fejlesztőnek (frissítve: 2026-11-04, v74 után)

Gyors eligazítás annak, aki a projektet nagyjából ismeri, de csak a **GitHubot** és a **Cloudflare-t** látja (a fejlesztő gépét nem).

## Hol van minden

| Mi | Hol |
|---|---|
| Forráskód | github.com/djskyboy17/gastro_garage |
| Munkaág | **`import/v14`** – ez a friss. A `main` régi, ne abból dolgozz. |
| Utolsó közzétett változat | **v74** (`5ea5939`, tag `v74-napi-zaras`), ez fut élesben is. Minden változatnak tagje van: `v58-telepulesek` … `v72-nir`, `v74-napi-zaras` (a v73-nak nincs külön tagje, a v74-gyel együtt ment ki). |
| Futó alkalmazás | Cloudflare Worker **`konyha`** (telepített verzió: `732d47e9`) |
| Adatbázis | Cloudflare D1 **`konyha-db`** (az azonosítója a D1 felületén látszik) |
| Címek | konyha.veres.no (konyha / iroda), gastrogarage.veres.no (ügyfélportál), courier.veres.no (futár) |
| Szabályok és leírás | `AGENTS.md`, `README.md`, `TELEPITES.md`, `FEJLESZTESI-TERV.md`, modulonként `src/modules/<modul>/SPEC.md` |

## Mi került ki legutóbb (v73 + v74)

- **v73 – 2. fázis: gyártási tétel + bon de consum** (`src/modules/production/`, migráció `0029`). Ételenként napi egy gyártási tétel receptpillanatképpel; lezáráskor FEFO szerinti anyagkiadás és sorszámozott bon de consum (BC-…), sztornóval. Ha egy ételnek aznap tétele van, rendelésenként nem adható ki rá anyag (`ISSUE_BATCHED`). A címke a tétel adataiból készül.
- **v74 – 3. fázis: napi zárás, maradék, selejt** (migráció `0030`). A konyha a nap végén rögzíti a dolgozói étkezést, a selejtet és az adományt; a maradék (ha még fogyasztható) másnapra a készletben marad. Napi selejt-PV (PVC-…), opcionális bon de predare (BP-…, alapból ki), a korábbi rendelések címkéje a régebbi tétel adatait kapja.
- **Teljesítményjavítás** (egy másik munkamenetből, ugyanebben a commitban): a portál mai + heti menüje egy `GET /api/portal/menu-board` kérésből; `/api/data` csak a szerepkör által látott modulokat tölti be; Intl-formázók újrahasznosítása; sorok egyszeri csoportosítása (`src/modules/shared/format.ts`, `collections.ts`). Mérés: `node --experimental-strip-types scripts/benchmark-cpu.mjs` (helyi szám, nem Cloudflare CPU-mérés).
- Részletek: `src/modules/production/SPEC.md`, `FEJLESZTESI-TERV.md` (0–3. fázis kész).

## Éles állapot (v74)

- Az éles D1-en a **0030-as migrációig** minden lefutott. Új migráció **0031**-gyel kezdődik.
- Utolsó mentés az élesítés előtt: D1 export + time-travel könyvjelző `000000a2-00000000-00005118-316ef30b8867ece3fe3bef4c23dbcc33` (a v72 állapota, a 0029/0030 előtt).
- Titkok a Workerben (értékük csak a Cloudflare-ben van, **soha ne kerüljön chatbe vagy a tárolóba**): `GEMINI_API_KEY`, `GOOGLE_CLIENT_SECRET`, `KITCHEN_OWNER_EMAIL`, `OWNER_SETUP_CODE`.
- Telepítéskor a `BUILD_VERSION / BUILD_COMMIT / BUILD_TIME` változók is átmennek (a Beállításokban látszik a futó változat).
- Az éles adatbázisban van egy próba-AI-számla piszkozatban (GASTRO GARAGE S.R.L., GG 2026-0101) – a tulajdonos elvetheti.
- Az új gyártási és napizárási lapokat élesben bejelentkezett felhasználó még nem próbálta ki.

## Amire figyelni kell

- A `design/` mappa (portálminta) szándékosan nincs a tárolóban.
- **Bizonylat nem törölhető, csak sztornózható** (NIR, BC, PVC, BP). A sorszámot a `documents` modul adja, a bizonylattal egy D1-kötegben.
- Lezárt napra nem vehető fel / zárható le / sztornózható gyártási tétel; előbb az admin visszanyitja a napot (`/api/production/day/reopen`).
- A bon de predare és a selejt-PV formája **[ELLENŐRIZENDŐ]** a könyvelővel; a bon de predare ezért beállítás, alapból ki.

## Munkarend (kötelező)

1. **Élesítés, commit, push csak a tulajdonos kifejezett jóváhagyásával.** Gyakori válasz: „Még ne”.
2. **Migráció vagy éles adatmódosítás előtt mentés:** D1 export SQL-be + time-travel könyvjelző (`wrangler d1 time-travel info konyha-db`). Hiba esetén a könyvjelzőre állunk vissza.
3. Ellenőrzés: `node node_modules/typescript/bin/tsc --noEmit`, `node --experimental-strip-types --test tests/*.test.mts` (145 teszt), `node scripts/run-framework.mjs build`.
4. Parancsok: `npm run cf:migrate` (éles migráció), `npm run cf:deploy` (telepítés), `npm run cf:gemini` (Gemini-kulcs – a tulajdonos maga írja be a terminálba). A szkriptnek kell egy helyi `cloudflare.json` (`workerName`, `databaseName`, `databaseId`) – nincs a tárolóban.
5. Pénz egész baniban, dátum Europe/Bucharest szerint, felületi szöveg magyarul és románul, hivatalos bizonylat (NIR, BC, PV, BP) románul.
6. Commit-üzenet angolul; dokumentáció magyarul.
7. Ha ugyanabban a mappában két munkamenet dolgozik, mindkettő a saját változását külön commitolja, mielőtt a másik hozzányúl – különben a változások összefonódnak.

## Hozzáférés adása (ezt a tulajdonos csinálja)

**GitHub**
- Repository → *Settings* → *Collaborators* → *Add people* → a másik fél GitHub-fiókja, szerep **Write**.
- Vagy, ha csak egy AI-eszköznek kell: fiókod → *Settings* → *Developer settings* → *Fine-grained personal access token*, csak a `gastro_garage` tárolóra, *Contents: Read and write*, rövid lejárattal.

**Cloudflare**
- Ember esetén: *Manage Account* → *Members* → *Invite*, szerepkörök: **Workers Admin** és **D1** (ha a DNS-t is kezelnie kell, a `veres.no` zónához *DNS*).
- AI-eszköz esetén: *My Profile* → *API Tokens* → *Create Token* → egyéni token ezekkel:
  - Account · **Workers Scripts: Edit**
  - Account · **D1: Edit**
  - Account · **Account Settings: Read**
  - Zone (veres.no) · **Workers Routes: Edit** (csak ha útvonalat kell módosítania)
  - rövid lejárat; a tokent közvetlenül az eszköz titoktárába tedd, ne chatbe.
- A hozzáférés munka végén visszavonható: GitHubon a collaborator / token törlése, Cloudflare-ben a tag eltávolítása / token *Roll* vagy *Delete*.

## Mi jön

- A gyártási tételek és a napi zárás kipróbálása élesben (iroda + konyha); a PV aláírói és az ételek fogyaszthatósági ideje beállítandó.
- 4. fázis: aviz (szállítólevél) – `FEJLESZTESI-TERV.md`.
- A könyvelővel egyeztetendő: bon de predare, selejt-PV formája, készletértékelés (FIFO / súlyozott átlag).
- Nyitott: a cégadatok a NIR-en / BC-n / PV-n; e-mailes jelszó-visszaállítás csak a végleges domain után; a teljesítményjavítás felhős (CPU-keret, hidegindulás) ellenőrzése.

## Helyi fejlesztés – 2026-11-05, könyvelési testreszabás

A fenti v74-es éles átadást követő, még nem commitolt helyi munka. A jelenlegi forrásban korábbi Tremol-híd és pénztárfejlesztés is található; ezeket megőriztük. E munkaszakaszban online telepítés, commit és push nem történt.

- Könyvelési profil: bruttó bevételezés, kötelező BP és minden kiszállításhoz aviz. Beállítások → Könyvelési szabályok. A normál helyi adatbázisban a profil alkalmazása továbbra is külön adminművelet; a teszteket elkülönített adatbázison végeztük.
- Futár rendeléskártya: Aviz megnyitása, jogosultságvizsgálattal.
- Költségszámla: Beszerzés → Számlák → A számla besorolása → Egyéb költség. Készlet/NIR nélkül véglegesíthető, naplózott negatív korrekcióval javítható. Kifizetés esetén előbb a kifizetés helyesbítése kell.
- Kimutatások: heti BC és havi, román nyelvű nyomtatási csomag. Belső bizonylatok, összesítők, meglévő Z/pénztár/konyhai zárás adatok; hiánylista és következő hónap 10-i határidő. Eredeti számla-, Z/POS- és bankmellékletek külön csatolandók/nyomtatandók; nincs automatikusan összevont eredeti PDF-csomag vagy archivált átadási státusz.
- Új migrációk: 0034 könyvelési profil és védőtriggerek, 0035 költségbejegyzések, 0036 dátumindexek. Tiszta tesztadatbázison minden migráció végigfutott. A normál helyi adatbázis sémája most 0036; integritás és FK rendben.
- Helyi migrációs eltérés: a korábbi nyilvántartás 0019-nél megállt, de a séma már 0033 volt. Baseline-ellenőrzés után csak a 0034–0036 migrációkat alkalmaztuk külön, a korábbi bejegyzések átírása nélkül. A teljes régi lista automatikus alkalmazása továbbra is 0020-nál ütközhet; ezt külön kell rendezni.
- Mentések: work/backups/before-accounting-20261105-114532, before-expenses-20261105-125642, before-report-indexes-20261105-125855. Ezek helyi futásadatok, Gitből kizárva.
- Ellenőrzés: 166 üzleti teszt, TypeScript, production build; elkülönített teljes böngészős költség/javítás/nyomtatás/jogosultság tesztek. Részletek: src/modules/accounting/SPEC.md és src/modules/invoices/SPEC.md.
- Következő feladat: tervezett készpénz/kártya a rendelésben és az egyetlen konyhai Tremol S25 nyomtatási folyamata. Oblio/SPV és több kassza továbbra is halasztott.

## Helyi fejlesztés – konyhai S25 nyugtafolyamat, 2026-11-05

- Rendelésfelvétel és ügyfélportál: tervezett készpénz/kártya külön mező; a portál előnézetéhez kötve. Régi/ismétlődő rendelésnél az iroda választhat. A tényleges befizetés továbbra is külön művelet.
- Rendelés részletei → Konyhai kassza: szimulált próba, állapottartó élő nyugta-előkészítés, tízperces .gastrobon, ellenőrzött .gastroresult import, előzmények és adminisztrátori egyeztetés. Ismételt/egyidejű kiadás elleni adatbázis- és helyi naplóvédelem, bizonytalan eredménynél megállás.
- Pénztár: egy konyhai készülék beállítása és a visszaigazolt élő nyugták összevetése a mentett Z-vel. Szimulációk nem számítanak valódi nyugtának, és nem hoznak létre befizetést. A normál helyi alkalmazás szimulációs alapmódban maradt; sorozatszám és élő feladat nem került bele a tesztekből.
- Új modul: src/modules/fiscal/SPEC.md. A régi GET /api/finance/tremol-job helyett az új nyugtafolyamat használandó. Az élő nyugtázott rendelés ár-, mennyiség-, díj-, dátum- és tervezettmód-adatai zároltak; a főzés és kézbesítés tovább haladhat. Nyugtasztornó/visszatérítés továbbfejlesztése későbbi fázis.
- Windows-kiegészítő: tools/tremol-bridge. Új eredményexport és Egyeztetes.cmd; a korábbi journal és helyi settings.json frissítéskor megmarad. Telepíthető csomag: work/releases/gastro-garage-tremol-s25-addon.zip. Csak a felsorolt programfájlokat és a kitöltetlen példakonfigurációt tartalmazza, futásadatot nem.
- 0037_kitchen_fiscal.sql generált és átnézett migráció, hozzáadott pillanatkép-védő triggerekkel. Tiszta adatbázison végigfutott a teljes történet; a korábbi helyi migrációs eltérés miatt a normál helyi adatbázison csak a 0037 futott külön. A 75 táblás séma és indexei egyeznek a Drizzle-pillanatképpel; integritás és idegen kulcsok rendben.
- Mentés a frissítés előtt: work/backups/before-fiscal-20261105-134159, SQLite backup és ellenőrzött 0036 alapállapot.
- Ellenőrzés: 170 Node domain/migrációs teszt; TypeScript és production build; PowerShell 5.1 régi és v2 mock SDK-teszt; elkülönített teljes böngésző → API → D1 → újratöltés, HU/RO és mobil. A normál helyi alkalmazás olvasási/felületi próbája is sikeres.
- Az élő módú szoftverpróbák elkülönített adatbázisban, mesterséges eredményfájllal és helyettesített SDK-val futottak. A saját Tremol S25 USB-kapcsolata, firmware/SDK-verziója, TVA-besorolása, fizetésihelyei és sorozatszáma készülékes beállítást és próbát igényelnek. A webes és a helyi híd live beállítása egyaránt szükséges a valódi kiadáshoz.
- Minden ebben a helyi projektben készült. Commit, push és online telepítés nem történt. Oblio/SPV, több kassza és futárkassza továbbra is halasztott.

## Tulajdonosi döntés – halasztott S25 készülékes próba (2026-11-05)

A hiánylistán szereplő 1. pontot, a Tremol S25 fizikai beállítását és készülékes próbáját a tulajdonos későbbre halasztotta. Ide tartozik az USB-kapcsolat, a sorozatszám, a firmware/SDK-egyezés, a TVA-besorolás, a készpénzes/kártyás fizetésihelyek és a tényleges nyomtatás ellenőrzése. Erre akkor térünk vissza, amikor a tulajdonos jelzi. A készülékes próba továbbra is nyitott, sikeresnek nem jelölhető; a helyi kasszafolyamat szimulációs módban marad. A többi fejlesztés folytatható.

## Helyi fejlesztés – egyszerűbb kezelőfelület, 2026-11-05

Tulajdonosi irányelv: a frontend legyen a lehető legegyszerűbb, a meglévő backend és üzleti működés maradjon meg. A további funkcióknál is a napi teendő, az egyértelmű következő lépés és a szükség esetén lenyitható részletek legyenek az alapelvek. A fontos figyelmeztetést és mentési hibát mindig láthatóan kell jelezni.

- Rövidebb főmenü: napi munkafolyamatok elöl; étlap, ételek, ügyfelek, receptek, rendszeres rendelések és számlák a További funkciók alatt. Minden menüpont a meglévő szerepkör szerinti hozzáférést követi.
- Rendelés: az állapotok és a következő művelet a pénzügyi panelek elé került. A lemondás külön További műveletek alatt; a szállítási részletek lenyithatók. A tényleges fizetés űrlapja látható, a befizetési előzmények és javítások lenyithatók.
- Nyugta: tömör állapot, lenyitható részletek és előzmények. Bizonytalan nyomtatásnál külön látható figyelmeztetés és automatikusan nyitott részletek. A készülékes próba halasztása érvényben marad, a normál helyi kassza szimulációs módú.
- Pénztár: egyenleg és pénztárkönyv előre; egyéb pénzmozgás, futárelszámolás, Z, nyugtaegyeztetés és beszállítói fizetés külön, lenyitható részek. Eltérés vagy sürgős elszámolás esetén az érintett rész kinyílik.
- Könyvelés: havi és heti nyomtatás külön, egyszerű kártyán; a ritkán használt könyvelési beállítások lenyithatók. Beszerzés → Számlák: bevételezési beállítások lenyithatók; a számlafeldolgozás megmaradt.
- Új közös UI-elemek: app/components/workspace-navigation.tsx, workspace-details.tsx, app/simple-ui.css; magyar/román UI-szótár: src/modules/shared/simple-i18n.ts.
- Backendmódosítás és sémafrissítés nincs. A 160 korábban meglévő backend/API/migráció/kasszahíd fájl bájtonkénti ellenőrzése változatlanságot igazolt; csak megjelenítési kód és UI-szótárak módosultak.
- Ellenőrzés: 170 sikeres domain/migrációs teszt, TypeScript és production build. Elkülönített böngésző → API → D1 → újratöltés: főzési állapot, befizetés, pénztári tétel, költségszámla, kimutatás megnyitása, bizonytalan nyomtatás és Z-eltérés láthatósága. Mobil HU/RO, konyhai szerepkör és billentyűzettel nyitható menü ellenőrizve.
- A normál helyi alkalmazáson csak olvasási és felületi próba történt. Online telepítés, commit és push nem történt.

## Helyi fejlesztés – rendelésfelvétel és aviz, 2026-11-05

- Végleges tulajdonosi pontosítás: először az ügyfél, dátum és ételek tölthetők ki; nincs fizetést kérő nyitóképernyő. Alul a két nagy Kártya/Készpénz gomb, majd a Mehet/Mégse. Csak a középső űrlaprész görgethető; az összeg és a gombok asztali és mobilnézetben elérhetők. A megjegyzés az utolsó adatmező.
- Számlás (`per_order`) és gyűjtőszámlás (`monthly`) ügyfélnél automatikusan kimarad a készpénz/kártya választás. A tervezett mód ilyenkor üres; nem feltételezünk átutalást és nem jelöljük fizetettnek. A számlázási módot a meglévő billing modul könnyű, irodai jogosultságú olvasási végpontja adja; betöltési hiba esetén a mentés vár a sikeres újrapróbálásig. Ügyfélváltás törli az előző fizetési választást.
- Nagy Napi menü gomb a kiválasztott nap mentett leves/főétel összetételével és közös menüárával; alatta más tételek. Nem konfigurált napra a menügomb tiltott, más étel továbbra is rendelhető.
- A meglévő POST /api/orders bővült az @napi_menu kezelésével: szerveroldali ár és két recepthez kapcsolható pillanatképsor, összeghelyes bani-felosztás, menünap/menüár revision-ellenőrzés a tranzakcióban. Elavult menü esetén új ügyfél sem jön létre; korábbi rendelés ára nem változik. Nincs új migráció és nincs rendelésfelvételkori készletfogyasztás.
- Aviz közös szabály: Beállítások → Aviz beállítások; kikerült a Csomagolásból és az egyedi rendelés jelölése a napi felületről. A kiállítás/megnyitás műveletei megmaradtak. A normál helyi adatbázisban a „Minden kiszállításhoz kötelező aviz” bejelentkezett tulajdonosként, az alkalmazás mentésével bekapcsolva. Előtte ellenőrzött SQLite-mentés: work/backups/before-aviz-settings-20261105-154233.
- Ellenőrzés: 174 sikeres domain/migrációs teszt, TypeScript, production build. Elkülönített böngésző → API → D1 → újratöltés: napi menü összeghelyes mentése, normál/számlás/gyűjtőszámlás ügyfél, ügyfélváltás, betöltési hiba és újrapróbálás, mobil 390×568 és HU/RO. Mentett rendelések továbbra is unpaid állapotúak. A tesztadatok az elkülönített work/order-entry adatbázisban maradtak.
- A normál helyi kassza szimulációs alapmódú maradt; fizikai S25-próba továbbra is halasztott. Commit, push és online telepítés nem történt.

## Helyi fejlesztés – havi gyűjtőszámlás rendelés pénzbeszedés nélkül, 2026-11-05

Tulajdonosi kérés: havi gyűjtőszámlánál a rendelés részleteiben ne legyen fizetés, mert a számlázás előtt nincs pénzbeszedés.

- A részletekben havi módnál eltűnik a fizetési státusz mező, az új befizetési űrlap és az új konyhai nyugta készítése. A számlapanel megmarad a havi gyűjtőszámla tájékoztatásával. A korábban létrejött befizetések/nyugták előzménye és javítási, egyeztetési lehetősége megmarad; nem törlünk vagy jelölünk fizetettnek korábbi adatot.
- A finance/fiscal olvasás jelzi a collectionDeferred szabályt; a fizetési státusz a már meglévő kérés eredményéből frissül, ehhez nincs külön frontend-lekérdezés.
- Az iroda és a futár rendelésenkénti új beszedését, illetve a havi rendelés új készpénz/kártya tervezését és nyugta-előkészítését a szerver is tiltja (PAYMENT_MONTHLY_INVOICE). A közös billing/order-collection.ts SQL-feltétel az írási kötegben is lefut, így a közben átállított ügyfélprofil sem enged pénzbeszedést. A havi ügyfél rendeléséhez korábban előkészített élő nyugtafájl sem tölthető le új kiadás céljából; meglévő eredmény egyeztetése továbbra is lehetséges.
- A fizetés a kiállított számla meglévő befizetési folyamatában történik; a függőben lévő számlánál ez a végpont már eddig is tiltott. A rendelésbefizetést havi módban számlázás után sem használjuk, hogy ugyanaz a pénz ne kerüljön két helyre.
- Nincs új migráció vagy normál helyi adatmódosítás. A havi szabály az ügyfél mentett számlázási profilját követi. Receipt/per_order rendelés beszedése változatlan; a normál kártyás befizetés és szimulált nyugta-előkészítés is kipróbálva.
- Ellenőrzés: 176 sikeres domain/migrációs teszt, TypeScript, production build. Elkülönített teljes böngésző → API → D1 → újratöltés: havi rendelés rögzítése, eltűnő fizetési/nyugtaelemek, tiltott irodai készpénz/kártya és futárbeszedés, kézbesítés beszedés nélkül, korábbi előzmények megőrzése, HU/RO, szimulált havi számla kiállítása és számlára fizetése. D1-ben nincs rendelésbefizetés/nyugta a havi tesztrendeléshez; egy befizetés van a kiállított számláján.
- Online telepítés, commit és push nem történt. Fizikai S25, éles Oblio/SPV továbbra is halasztott; a próbák elkülönített adatbázison és szimulációval futottak.

## Git-mentés – 2026-11-05

A fenti helyi fejlesztések forrása, migrációi, tesztjei és dokumentációja a tulajdonos kérésére egy helyi Git-commitba rendezve. A helyi adatbázisok, mentések, tesztfutási adatok, titkok és gépi beállítások nem részei a commitnak. Push és online telepítés továbbra sem történt. Az utolsó kódellenőrzés: 176 sikeres teszt, TypeScript és production build.

## Tulajdonosi működési szabály – napi anyagkiadás, 2026-11-06

Kért következő változtatás, MÉG NINCS IMPLEMENTÁLVA: ételenként csak az elkészült adagszám rögzítése történjen; az alapanyagok végleges kiadása és a napi bon de consum csak a teljes napi zárás végén, közösen történjen. Az egyes étel rögzítése nem csökkentheti a nyersanyagkészletet. A fogyasztás az összes ténylegesen elkészült adagra vonatkozik, nem csak az eladottra; a maradék/selejt ettől külön késztermékmozgás.

A jelenlegi close végpont ételenként fogyaszt és BC-t készít, a napi zárás már lezárt gyártási tételeket vár. Emiatt ez nem pusztán feliratmódosítás: a késztermék rendelkezésre állását és a nyersanyag-felhasználás könyvelését külön kell választani. A kézbesítés és az aviz nap közben továbbra is működjön. Napi véglegesítéskor közös, atomikus készletellenőrzés és anyagkiadás kell, ismételt zárásból nem lehet dupla fogyasztás; hiány/stale revision esetén semmi nem könyvelődhet részlegesen. Korábbi BC-ket és már kiadott anyagot nem szabad újra levonni; újranyitásnál a kapcsolódó helyesbítés szabályát is ki kell dolgozni. A korábbi alkalmazott migrációkat nem írjuk át.

Ez a bejegyzés csak a kért szabályt és a szükséges átállást rögzíti; a futó alkalmazás anyagkiadási működése ettől még nem változott meg.

## Megvalósítva – közös napi anyagkiadás, 2026-11-06

Az előző fejezetben még függőként rögzített tulajdonosi szabály elkészült. A változtatás helyi; commit, push és online telepítés nem történt.

- Konyhai terv → Gyártási tételek: az Elkészült adag mentése csak a tényleges adagokat és a rögzített receptből számolt anyagigény pillanatképét menti. Nem von le nyersanyagot és nem készít ételenként BC-t. A késztermék nap közben rendelkezésre áll a címkézéshez, avizhoz és kiszállításhoz.
- Rendelés nélkül is felvehető gyártás: Étel hozzáadása a napi gyártáshoz → étel és tervezett adag → Tétel felvétele, majd a tényleges adag mentése. Ételenként és naponta továbbra is egy gyártási tétel van, összesített tényleges mennyiséggel.
- Konyhai terv → Napi zárás → Nap lezárása: egy közös, atomikus FEFO anyagkiadás és egy napi bon de consum az összes új, halasztott gyártási tételhez. A dolgozói/selejt/adomány/maradék elszámolása ugyanebben a tranzakcióban történik. Készlethiány vagy közben változott adatok esetén nincs részleges levonás. Adminnak külön Napi bon de consum megnyitása gomb; a korábbi jogosultságok megmaradtak.
- Bon de predare: ha kötelező/engedélyezett, a nap végén készül a tényleges anyagköltséggel, gyártási tételenként. A könyvelési profil az új halasztott tételek készre mentését megengedi a napi BP előtt; a régi tétellezárási védelem megmaradt.
- Újranyitás: a napi BC és a hozzá tartozó BP-k sztornózódnak, a nyersanyag visszakerül, az elkészült adagszámok megmaradnak. Újbóli zárás új bizonylattal pontosan egyszer fogyaszt. Havi/korábbi bizonylatokat nem írunk át. Korábbi, már lekönyvelt gyártás és régi stock_issues nem kerül újra levonásra.
- A régi POST /api/operations/issue rendelésenkénti anyagkiadás 410 USE_DAILY_MATERIALS hibával lezárva, a Raktárból a gomb eltávolítva. A régi kiadások olvashatók maradnak. A napi és előretekintő beszerzési terv a még le nem könyvelt, de már elkészült gyártás alapanyagigényét is figyelembe veszi, könyv szerinti készletváltoztatás nélkül.
- Mobiljavítás: egy korábbi, 1250 px alatti globális CSS-szabály elrejtette a gyártási és napi zárási paneleket. Az új szerkeszthető panelek saját osztálya ezt felülírja; a többi panel elrendezése megmarad.
- Generált/átnézett migrációk: 0043_daily_materials (halasztott anyagpillanatkép és a könyvelési trigger kiegészítése), 0044_production_day_guards (lezárt napra érkező új/módosított gyártás tiltása), 0045_pending_materials_index (csak a még nem könyvelt sorok indexe). Korábban alkalmazott migráció nincs átírva.
- Normál helyi adatbázis: a 0042 alapállapot összes táblájának oszlopai ellenőrizve, előtte integritásvizsgált SQLite-mentés: work/backups/before-daily-materials-20261106-004340. Csak az új 0043–0045 migrációkat alkalmaztuk. A korábbi migrációs naplóhézag megmarad; nem szabad vakon a teljes történetet újrafuttatni. A normál adatbázisba tesztgyártás vagy tesztbefizetés nem került, integritás/FK rendben.
- Ellenőrzés: 188 sikeres Node domain/migrációs teszt, TypeScript, production build. Elkülönített böngésző → API → D1 → újratöltés: 7+11 adag, 180 g közös anyagigény, 100 g készletnél teljes visszagörgetés; pótlás után 200→20 g és egy 1800 banis közös BC, két BP. Aviz a napi anyagkiadás előtt is kiállítható. Elavult előnézet és dupla/egyidejű zárás tiltott. Újranyitás/újrazárás után is pontos készlet. Mobil HU/RO és normál helyi, csak olvasási felületi próba sikeres.
- A fizikai S25-próba és az éles Oblio/SPV továbbra is halasztott. A normál helyi fejlesztői cím http://127.0.0.1:5174/.

### Párhuzamos Git-munka állapota

A fejlesztés közben másik munkamenet létrehozta az e087439 (Simpler courier task card, v89) commitot, amelybe ennek a napi gyártási fejlesztésnek az app/src módosításai is bekerültek. Ebben a munkamenetben nem indítottunk commitot vagy push-t. A 0043–0045 migrációk és Drizzle-metaadatok, a db/schema.ts hozzáadása, a tests/daily-materials.test.mts és e dokumentáció a munka végén még helyi módosításként maradtak. Ezek a forrásmódosítások szükséges társai, és együtt kell őket verziókezelni; az e087439 önmagában nem tartalmazza a teljes adatbázis-átállást. Másik munkamenet változását nem vontuk vissza.

### A kiegészítő Git-mentés lezárása

A tulajdonos kérésére a napi anyagkiadás hiányzó sémája, 0043–0045 migrációi és metaadatai, tesztjei és átadási dokumentációja külön kiegészítő commitba rendezve. Ezzel az e087439 forrásmódosításaihoz szükséges adatbázis-átállás is verziókezelésbe kerül. Push és telepítés e munkamenetben nem történt.
