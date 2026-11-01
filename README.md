# Konyha – rendelés, receptúra és raktár

Nyilvános tesztalkalmazás: https://konyha-catering-zsolt.tinykoi1025.chatgpt.site. Az adatkezeléshez ChatGPT-belépés szükséges. A munkatérhez dolgozói jóváhagyás szükséges; az adatokat a szerver a munkakör szerint szűri.

## Kipróbálás

1. Nyisd meg az alkalmazást. A kezdeti adatbázis üres.
2. A „Mintaadatok betöltése” gomb 4 jelölt ételt, 3 ügyfelet és 3 rendelést készít a betöltés napjára. A minták nem valós ügyfelek; a címek szemléltető példák.
3. A HU / RO kapcsoló váltja a felület és az ételek nyelvét.
4. Az ételkatalógusban és ügyféltörzsben saját bejegyzéseket adhatsz hozzá.
5. Vegyél fel rendelést, és nézd meg a napi konyhai összesítőt.
6. A rendelés megnyitásával jelöld: készül → elkészült → átadás a futárnak → kézbesítve. A fizetést külön kell jelölni.
7. A rendeléslista CSV-be exportálható, a napi nézet nyomtatható.

Az „ételes adag” az összes rendelt ételadag összege: egy leves és egy főétel két adagként számít, nem egy főként.

## Elkészült

HU/RO felület és keresés; étel- és ügyfélfelvétel; rendelésfelvétel; napi terv; kiszállítási állapotok; elkülönített fizetési állapot; adatbázis-mentés; eseménynapló; nyomtatás; CSV. A mentéskor szerveroldali ellenőrzés, rendelésenként verzióellenőrzés, ár- és allergénpillanatkép készül.

Alapanyagtörzs g/ml/db egységekkel, receptváltozatok és alapanyagköltség, áruátvétel tételszámmal és lejárattal, kézzel jóváhagyott gyártási kiadás és selejt, visszakereshető készletmozgások, napi beszerzési hiánylista és CSV. A rendelésfelvétel nem csökkenti a készletet. A Raktár oldalon külön gombbal tölthetők be a raktári mintaadatok; előbb az alap mintaadatokat kell betölteni.

Beszállítótörzs; a hiánylistából készíthető belső beszerzési rendelések; szerkeszthető piszkozat, véglegesítés, részszállítások, hátralék lezárása. Az átvétel a beszerzéshez kapcsolt raktári tételt hoz létre. A terv külön számolja a várható szállításokat; ezek csak tényleges átvétel után használhatók fel. A beszerzési dokumentum nyomtatható, a továbbítás kézzel történik.

Futártörzs; rendeléshez mentett futárkijelölés; futár és állapot szerint szűrhető, nyomtatható napi kiszállítási lista; kézbesítési megjegyzések és kötelező sikertelenségi indok, eseményelőzmények. Induláshoz elkészült rendelés és kijelölt futár szükséges. A futárkijelölés nem hoz létre dolgozói fiókot.

## Még tervezett

adalékanyagok nyilvántartása és az ételinformáció jóváhagyása; automatikus beszállítói továbbítás és NIR; teljes HACCP-terv és szenzorintegráció; számlázás/e-Factura; útvonaltervezés; online fizetés és ügyfélportál-bővítések; offline működés; korrekciós/visszafordító műveletek. A jelenlegi változat tesztelésre szolgál.

## Technikai alap

TypeScript + React + Vinext; Drizzle; Sites D1/SQLite. Ez eltérés az eredeti PostgreSQL-javaslattól: a gyors kipróbálást szolgálja. A PostgreSQL-váltás külön adaptert és üzemeltetési döntést igényel. A kód egy alkalmazásban marad. A szabályok: AGENTS.md; jelenlegi specifikáció: src/modules/shared/SPEC.md.

## Fejlesztői ellenőrzések

`node node_modules/typescript/bin/tsc --noEmit`

`node --experimental-strip-types --test tests/domain.test.mts tests/inventory.test.mts tests/purchasing.test.mts tests/delivery.test.mts tests/access.test.mts tests/safety.test.mts tests/recurring.test.mts tests/portal.test.mts`

Helyi szerverrel: `node tests/api-smoke.mjs`, `node tests/inventory-api.mjs` és `node tests/purchasing-api.mjs`, `node tests/delivery-api.mjs`. Ezek kizárólag a helyi adatbázisba írnak tesztadatokat.

`npm run build`

Helyi előnézet: `npm run dev`. Helyi belépés: `/signin-with-chatgpt?return_to=/`. A helyi és a közzétett adatbázis különálló. A helyi D1-migrációhoz a Sites starter README-jét kövesd. A mintafeltöltés csak az aktuális környezetbe ír; a helyi tesztadatok nem kerülnek a közzétett változat adatbázisába.

## Dolgozói hozzáférés

Tulajdonos/admin, diszpécser, konyha és raktár/beszerzés szerepkörök. Új belépő hozzáférést kér; az admin a Dolgozói hozzáférés menüben hagyja jóvá vagy tiltja le. A tulajdonos és a saját szerepkör nem módosítható itt. A futártörzs továbbra sem jelent bejelentkezési fiókot.

Az első tulajdonos beállításához a KITCHEN_OWNER_EMAIL runtime titkot kell megadni a megerősített tulajdonos emailjével. A megfelelő Sites-fiókkal belépve a Tulajdonosi munkatér megnyitása gomb egyszer rögzíti a stabil felhasználóazonosítót. Hiányzó konfiguráció esetén senki nem kap automatikus adminjogot. A nyilvános oldal a belépési felületet teszi elérhetővé; a munkatér adatait nem. A rendszer továbbra is tesztelésre szolgál.

## HACCP és minőségellenőrzési napló

Az admin magyar/román ellenőrzőpontokat és saját hőmérsékleti határokat állít be. A konyha és a raktár aktuális ellenőrzést rögzíthet, a bejegyzés az eredeti határokat őrzi. Az eltéréshez megjegyzés kell; az admin csak javító intézkedéssel és későbbi megfelelő utóellenőrzéssel zárhatja le. Korábbi határok lazítása nem zárja le a korábbi eltérést. A napló nyomtatható. A modul nyilvántartási segédlet, nem teljes HACCP-terv vagy tanúsítás; nincsenek előre megadott élelmiszerbiztonsági határértékek.

## Ismétlődő rendelések

Heti sablon ügyféllel, ételekkel, adagokkal, érvényességi idővel, heti napokkal és kihagyott dátumokkal. Az admin/diszpécser legfeljebb 31 napot állíthat elő kézzel, előnézet után, az aktuális árakkal és törzsadatokkal. Egy sablon egy napjára csak egy rendelés készül; a már létrehozott és a lemondott rendeléseket az ismételt előállítás kihagyja. A sablon módosítása vagy szüneteltetése nem változtatja meg a meglévő rendeléseket. Nincs automatikus időzítés vagy ünnepnapnaptár.

## Ügyfélportál

A /portal címen nyilvános étlap és saját ügyfélfiókos rendelésfeladás érhető el HU/RO nyelven. A belépéshez a meglévő ChatGPT/Sites bejelentkezés használható, dolgozói jogosultság nem szükséges. Az admin/diszpécser az Ügyfélportál menüben jelöli ki a közzétett ételeket; az alapértelmezés rejtett. Az ügyfél menti a saját szállítási adatait, kosarat állít össze, előnézet után elküldi a rendelési kérését. Csak a saját portálos rendeléseit látja.

A kérés visszaigazolásra vár, addig nem kerül a gyártási vagy alapanyagtervbe. Az admin/diszpécser visszaigazolja vagy indokkal elutasítja; az ügyfél a még függő kérését visszavonhatja. A portálfiókokat admin tilthatja le. A rendszer nem kapcsol automatikusan össze meglévő ügyfeleket e-mail alapján. Nincs online fizetés; a változat továbbra is tesztelésre szolgál.

## Napi / heti étlap — v9

A „Napi / heti étlap” menüpontot a tulajdonos, admin és diszpécser használhatja. Hét napos áttekintésben választható ki a kiszolgálás napja; dátumonként külön ételek, maximális adagszám, rendelési határidő és nyitott/zárt állapot menthető. A határidő romániai idő szerint értendő, az óraátállítás kezelve van. Előre legfeljebb 90 napra tervezhető; a portál továbbra is 30 napra fogad kérést.

Az ügyfélportál a kiválasztott nap kínálatát és elérhető adagjait mutatja. Először az Ügyfélportál kezelőfelületén publikáld az ételt, majd tedd be egy megnyitott napi étlapba. Be nem állított vagy lezárt napra, illetve határidő után nem lehet portálrendelést feladni. A frissítés nem készít automatikusan napi étlapokat; a korábbi rendelések megmaradnak.

A függő és visszaigazolt rendelések is foglalják az adagszámot; a lemondás/elutasítás felszabadítja. A napi étlapon szereplő étel korlátja a belső és ismétlődő rendelésekre is vonatkozik, adatbázisban ellenőrizve párhuzamos beküldéskor is. Belső rendeléshez étlapon kívüli étel is választható. Foglalt sor nem törölhető, a korlát nem csökkenthető a foglalt mennyiség alá. A napi étlap lezárása nem törli a meglévő rendeléseket.

Ellenőrzés: 45 sikeres tartományteszt, portál API regresszió, napi étlap API próba (utolsó adag versenyhelyzet, lemondás, visszagörgetés, jogosultságok, régi előnézet, lezárás, határidő), böngészős mentés és portálrendelés. A napi/heti kínálat még nem jelent teljes konyhai vagy idősávonkénti kapacitástervezést. Függő foglalások automatikus lejárata nincs.

## Leltár és korrekciók — v10

A „Leltár és korrekciók” oldalon a raktáros, admin vagy tulajdonos legfeljebb 30 meglévő raktári tételt választhat egy részleltárhoz. A megszámolt mennyiséget egész g/ml/db alapegységben kell megadni. Az üres mező még nem számolt tétel; a 0 kifejezett nulla mennyiséget jelent. Az eltéréshez indoklás szükséges. A piszkozat mentése nem módosít készletet.

A tulajdonos vagy admin hagyja jóvá az eltéréseket. A rendszer tételenként ellenőrzi, történt-e közben készletmozgás; elavult számolást nem könyvel. A jelzett sornál az „Újraszámolás indítása” az aktuális alapot veszi át és törli a korábbi számolt értéket. Új fizikai számolás szükséges. A leltár a mentett pillanatképekkel nyomtatható.

A jóváhagyás külön előjeles készletmozgásokat hoz létre. Az eredeti átvételi mennyiség, költség, lejárat és beszerzési bizonylat nem változik; a nettó leltárkorrekció külön látható a raktári tételnél. A becsült készletérték továbbra is az eredeti átvétel egységárát használja.

A hibás jóváhagyás indoklással visszafordítható, ha az érintett készlet azóta nem változott. A visszafordítás ellentétes mozgásokkal dolgozik és megőrzi a dokumentumot. Későbbi anyagkiadás, selejt vagy más korrekció után új leltárt kell készíteni. Ez nem általános áruátvétel- vagy gyártásikiadás-visszavonás; azok külön fejlesztések.

Ellenőrzés: 47 tartományteszt, részletes leltár API-próba, raktári/beszerzési regresszió, adatokkal és idegen kulcsokkal ellenőrzött sémafrissítés, TypeScript és publikálható build. Továbbra is tesztalkalmazás; nem helyettesíti a hivatalos éves leltár dokumentációját.

## Portál rendelési és átvételi szabályok — v11

A „Rendelési szabályok” menüpontban a tulajdonos/admin állíthatja be a portál kiszállítását és személyes átvételét. A diszpécser megtekintheti a szabályokat. Beállítható a magyar/román átvételi cím, a minimum ételérték, a névvel ellátott szállítási körzetek pontos hatjegyű román irányítószámai és díjai, heti idősávok rendeléskorláttal, heti zárvatartás és konkrét zárt/ünnepnapok. Automatikus körzetet, címet vagy díjat a frissítés nem hoz létre.

Az ügyfél választ átvételi módot, dátumot, irányítószámot (kiszállításhoz) és idősávot. Az ételadagok korlátja mellett egy rendelés egy idősávhelyet foglal; a függő kérések is foglalnak. Lemondás vagy elutasítás felszabadítja a helyet. Az ügyfél által megadott irányítószámot a konyha jóváhagyáskor a címmel együtt ellenőrzi; nincs automatikus címellenőrzés vagy távolságszámítás.

Az előnézet külön mutatja az ételek összegét, a szállítási díjat és a fizetendő végösszeget. A minimum csak az ételek értékére vonatkozik. A végleges díj, körzet és idősáv a rendeléshez mentődik; a későbbi szabályváltozás nem írja át. A diszpécser nézete, a futárnál beszedendő összeg és a rendelés-CSV is figyelembe veszi a mentett díjat. A CSV-ben a díj és a rendelési végösszeg csak az első tételsorban szerepel.

Személyes átvétel nem kerül a futárlistába. Jóváhagyott és elkészült rendelésnél az „Átvétel rögzítése” gomb zárja le az átadást; a fizetés külön állapot marad. Kiszállításnál a meglévő futárkiosztás és indulási feltételek maradnak.

A portálhoz a napi étlapnak ÉS a rendelési szabályoknak is engedniük kell a napot. Első használat előtt ments aktív módot, megfelelő körzetet/címet és pozitív kapacitású idősávokat. A belső kézi és ismétlődő rendelések továbbra is külön munkatársi kivételek: automatikus portáldíj és idősávfoglalás nincs hozzájuk; a napi ételkapacitást viszont betartják. Nincs globális konyhai kapacitás, automatikus foglaláslejárat vagy online fizetés.

Ellenőrzés: 50 tartományteszt, teljes portál- és napiétlap-regresszió, új kiszállítási/átvételi API-próba (utolsó idősávhely versenyhelyzete, minimum, irányítószám, zárt nap, régi előnézet, díjpillanatkép, kapacitás és jogosultságok, személyes átadás), TypeScript és publikálható build.

## Futár mobilos munkatér — v12

A `/courier` útvonal külön, HU/RO mobilos felület. A futár csak a hozzá kapcsolt futártörzshöz kiosztott, jóváhagyott kiszállításokat láthatja: mentett ügyfélnév, cím és telefon, idősáv, ételnevek/adagok/allergének és kézbesítési megjegyzés. Árak, fizetési adatok, raktár, receptek és más futárok feladatai nem érhetők el ezen az API-n.

Beállítás: a futár bejelentkezik a `/courier` oldalon és dolgozói hozzáférést kér. Tulajdonos/admin: Dolgozói hozzáférés → Futár szerepkör mentése → Futárfiókok összekapcsolása → megfelelő nyilvántartott futár és dolgozói fiók kiválasztása → Összekapcsolás mentése. A futártörzs továbbra is a Kiszállítás oldalon kezelhető. Azonos nevű felhasználó nem kap automatikus hozzáférést. Egy fiók egy futárhoz kapcsolható. Szerepkör-visszavonáskor a kapcsolat is megszűnik.

A futár naponként látja feladatait; a korábbról elmaradt, be nem fejezett és az úton lévő feladatok megmaradnak a listában. Kész étellel indíthat kiszállítást, majd rögzítheti a kézbesítést vagy a sikertelen átadást. Sikertelenséghez indoklás kell. Újraindításnál is az aktuális kiosztást és rendelésverziót ellenőrzi a szerver. Az állapot, esemény és audit egyszerre mentődik; azonos beküldés nem hoz létre dupla eseményt. A fizetés külön marad, a személyes átvételt a futár nem kezeli.

A navigációs gomb a mentett címet Google Térképen nyitja meg, kizárólag kattintáskor. A hívásgomb telefonhivatkozás. Nincs helymeghatározás, GPS-követés, kézbesítési fotó/aláírás, offline feladatmentés vagy automatikus értesítés. A lista kézzel frissíthető. A pénzügyi modul továbbra is későbbi fejlesztés.

Ellenőrzés: 52 tartományteszt, futár API-próba (saját feladatok szűrése, más futár adatai kizárva, fiókkapcsolat, jogosultság-visszavonás, dupla beküldés, átosztási versenyhelyzet, kézbesítési előzmények), hozzáférési és diszpécseri regresszió, sémafrissítés idegen kulcsokkal és adatokkal, TypeScript és publikálható build. Helyi tesztazonosságok kizárólag a helyi D1-adatbázisban vannak; nincs nyilvános teszt-belépés vagy megszemélyesítési API.

## Teljes rendelési folyamat ellenőrzése — v13

A `tests/workflow-api.mjs` egyetlen portálrendelést vezet végig a jóváhagyáson, beszállítói rendelésen és áruátvételen, készletkiadáson, elkészítésen, futárkiosztáson és kézbesítésen. Ellenőrzi az eredeti recept-, cím-, ár- és allergénadatok megőrzését, a hiányzó készlet miatti elutasítást, az ismételt beküldések kezelését és a változatlan fizetési állapotot. A `tests/workflow-db.py` a mentett helyi adatokat közvetlen, csak olvasó SQL-lekérdezéssel is ellenőrzi. Futtatás, határok és elfogadási példák: `tests/WORKFLOW.md`.

A 2026-10-29-i próba során román nyelvű böngészős portálrendelés, API-n végzett munkatársi műveletek, román futárindulás, magyar kézbesítés és az ügyféloldal újratöltése is sikerült mindkét nyelven. A folyamatban nem találtunk javítást igénylő működési hibát. Ez a változat ellenőrző teszteket és dokumentációt ad hozzá; nem vezet be új üzleti funkciót vagy sémafrissítést. A próbák helyi, fiktív adatokkal futnak. Az automatikus adatbázismentés és a pénzügyi integráció továbbra is későbbi feladat.

## Napi munkaterv és csomagolás — v14

Új menüpont a tulajdonos, admin, konyha és diszpécser számára. Az Adagterv a jóváhagyott rendelések mentett ételneveiből és allergénadataiból idősávonként számolja a tervezett, elkészült és ellenőrzötten csomagolt adagokat. A befejezett rendelések is szerepelnek a napi összesítésben. A kiválasztott nap bukaresti naptári nap, legfeljebb 90 napra vissza/előre.

A Csomagellenőrzés nézetben az elkészült rendelés minden tételén külön igazolható a teljes feltüntetett mennyiség becsomagolása. Részleges ellenőrzés is menthető, de csak minden sor kipipálása után lesz ellenőrzött a rendelés. Mentés és audit egyszerre történik, a rendelés verziójának ellenőrzésével. Indulás vagy személyes átadás előtt ez kötelező; a futár csak az ellenőrzött, elkészült, hozzá kiosztott rendelést indíthatja. Átadás után az ellenőrzés zárolt. Anyagkiadást vagy fizetést nem módosít. A rendelés részleteiből közvetlen gomb nyitja a megfelelő napi ellenőrzőlapot.

A Címkék nézet rendelésre szűrhető, magyarul és románul nyomtatható. Tételenként egy munkacímke készül a teljes adagszámmal, mentett ügyfélnévvel, rendelésszámmal, nappal/idősávval és allergénekkel. A nyomtatás nem jelöl csomagolást ellenőrzöttnek. Az üres allergénadat nem jelent allergénmentességet. Ezek munkacímkék; fogyaszthatósági/tárolási utasítást nem állítanak elő.

A 0012-es additív Drizzle-migráció a korábbi rendelések ellenőrzését nem tölti ki automatikusan. A még indulás/átadás előtt álló korábbi rendelések csomagolását is ellenőrizni kell; a már úton lévők lezárhatók. Az előzmények és rendelési pillanatképek változatlanok maradnak.

Ellenőrzés: 57 tartományteszt, csomagolási API (részleges/teljes ellenőrzés, újranyitás, párhuzamos/stale mentés, jogosultság, származás/JSON, indulási tilalom, zárolás, változatlan készlet/fizetés), diszpécseri/futár/személyes-átvételi és teljesfolyamat-regresszió, adatokkal ellenőrzött migráció. Böngészőből román részleges, magyar teljes mentés és újratöltés, közvetlen SQL-ellenőrzés sikeres. A címkenézetet ellenőriztük; a tényleges nyomtatóra küldés nem tesztelt, mert a beépített böngésző nyomtatási párbeszédét a vezérlés nem tudta befejezni. Határok és példák: `src/modules/packing/SPEC.md`. Az adatbázismentés és pénzügyi integráció továbbra is későbbi feladat.

## Al-receptek és tápérték — v15

A Receptúrák oldalon „Al-receptek (félkész termékek)” készíthetők, pl. alaplé vagy mártás: magyar/román név, kész mennyiség g-ban vagy ml-ben, alapanyagsorok nettó mennyiséggel és tisztítási veszteséggel. Mentéskor új változat készül. Al-recept csak alapanyagot tartalmazhat (al-recept az al-receptben nincs), aznap készül, nem raktári tétel. Az étel receptjében alapanyag- és al-receptsorok is szerepelhetnek; mindig az al-recept legfrissebb változata számít.

Az anyagkiadás, a beszerzési terv és az önköltség az al-receptet alapanyagaira bontja, mindkét lépésben felfelé kerekítve. Ha két előnézet között új al-recept-változat készül, a kiadást a szerver elavultként elutasítja. Hiányzó al-recept-változat hiányzó receptnek számít.

Az alapanyagoknál megadható a tápérték 100 g-ra (ml-ben mért alapanyagnál 100 ml-re), a fagyasztott jelölés és darabos alapanyagnál a darabtömeg; a „Tápérték és allergének” gombbal később is szerkeszthető. Új allergén az érintett ételekhez hozzáadódik, eltávolítás nem módosítja őket.

Minden receptes étel alatt „Ételinformáció” jelenik meg a legfrissebb receptből: összetevők csökkenő tömeg szerint (al-recept zárójelben, fagyasztott `*`-gal), allergének és tápérték 100 g késztermékre. Kész tömeg = adagszám × az étel adagtömege; ml ≈ g. Ha egy alapanyag tápértéke hiányzik, az étel tápértéke nem jelenik meg, a hiányzók listázva. Ez számított adat; jóváhagyás és adalékanyag-nyilvántartás még nincs.

Ellenőrzés: 66 tartományteszt (9 új: al-recept felbontás, kerekítés, elavult előnézet, hiányzó változat, önköltség, allergén, tápérték, hiányzó adat, darabtömeg), TypeScript és publikálható build, böngészőben al-recept létrehozása, receptbe illesztése és az ételinformáció megjelenése. A 0013-as Drizzle-migráció csak bővít, meglévő adatot nem módosít.

## Ételinformáció az ügyfélportálon — v16

A portál napi étlapján minden ételkártyán lenyitható „Ételinformáció” rész jelenik meg, még a kosárba tétel előtt: összetevők (al-recept zárójelben, fagyasztott `*`-gal), allergének és tápérték 100 g késztermékre, magyarul és románul. A nyilvános adat nem tartalmaz mennyiséget, grammot, receptet, önköltséget, beszállítót vagy készletadatot. Recept nélküli ételnél a portál azt kéri, hogy az ügyfél a konyhától érdeklődjön; hiányzó tápértéknél „még nincs megadva” jelenik meg.

Ellenőrzés: 67 tartományteszt (új: a nyilvános adat mezőlistája), TypeScript és publikálható build; böngészőben a portál magyar és román ételkártyája.

## Beállítások menü — v17

A főmenüben a „Modulok” helyett „Beállítások” szerepel. A ritkábban használt nézetek – HACCP és minőség, Rendelési szabályok, Dolgozói hozzáférés, Eseménynapló – a főmenüből a Beállítások oldalra kerültek, kártyákként; a modulok áttekintése is itt van (tulajdonos/admin). Egy beállítási rész megnyitásakor a menüben a Beállítások marad kiemelve, és „Vissza a beállításokhoz” gomb jelenik meg. A jogosultságok nem változtak: a konyha és a raktár a Beállítások alól éri el a HACCP-naplót, a diszpécser a rendelési szabályokat.

## 24 órás időmezők — v18

Az időpontok beviteli mezői (rendelés időpontja, ismétlődő rendelés, portál-idősávok kezdete/vége, napi étlap rendelési határideje) mindig 24 órás „ÓÓ:PP” formát használnak, a böngésző és a Windows nyelvétől függetlenül (pl. „1330” begépelve „13:30” lesz; 24:00 vagy afölötti érték nem menthető). A tárolt formátum nem változott.

## Szerkeszthető idősávok — v18

A Rendelési szabályokban egy idősáv ideje, napjai és módja addig szabadon átírható, amíg nincs rá rendelés. Ha már van (bármilyen állapotú) rendelés, ezek az adatok rögzítettek – ilyenkor kapcsold ki vagy töröld az idősávot, és vegyél fel újat; a hely (kapacitás) továbbra is módosítható. A mentés a tranzakción belül is ellenőrzi, hogy közben nem érkezett-e foglalás az átírt idősávra. 0 hellyel az idősáv nem foglalható.

## Élő rendelési állapot az ügyfélnek — v19

Az ügyfélportál „Rendeléseim” listájában minden rendelésnél lépéssor mutatja, hol tart: Beérkezett → Visszaigazolva → Készül → Elkészült → Úton → Kézbesítve (átvételnél: … → Átvehető → Átvéve). A lépések a konyhai, csomagolási és kiszállítási állapotokból számolódnak (`orderProgress` a `src/modules/portal/domain.ts`-ben); elutasított vagy lemondott rendelésnél nincs lépéssor, sikertelen kézbesítésnél figyelmeztetés jelenik meg. A lista 30 másodpercenként, illetve a fülre visszatéréskor magától frissül, de csak amíg az oldal látható; a kosár és a megkezdett űrlap ilyenkor nem változik.

## Konyhai „Kész” gomb — v20

A Konyhai terv kártyáin a nagy szám már a még elkészítendő adagot mutatja (mellette: kész / összes). Minden ételnél nagy „Kész” gomb van: megnyomva az étel összes még nem kész része késznek számít az aznapi rendelésekben. Ha egy rendelés minden része elkészült, a rendelés magától „kész” lesz, így csomagolható és kiküldhető; ha csak egy része, „készül”. Az elkészült ételek a lista végére kerülnek. A jelölést a konyha, az admin és a tulajdonos végezheti. Új migráció: `0014_kitchen_item_ready`.

## Tisztább konyhai terv és csomagolás — v21

A Konyhai tervről lekerült a rendeléslista (a Rendelések oldalon megvan). A csomagolásban csak az marad, amit még csomagolni kell: a futárnak már átadott, kézbesített vagy az ügyfél által átvett rendelés eltűnik a tervből, a rendelések és a címkék közül.

## Helyi próba-futárfiók — v22

A fejlesztői szerveren (`npm run dev`) a tulajdonosi próbafiók (Seedy) mellett van egy külön futár-próbafiók is, hogy a futárfelület egy gépen kipróbálható legyen:

1. Futárként belépés: http://localhost:5173/signin-with-chatgpt?as=courier&return_to=/courier („Teszt Futár”, futar@sites.test), majd „Hozzáférés kérése”.
2. Vissza tulajdonosként: http://localhost:5173/signin-with-chatgpt?return_to=/ → Beállítások → Dolgozói hozzáférés: a Teszt Futárnak Futár szerepkör, majd a Futárfiókok összekapcsolásánál a futárnévhez kötés.
3. Újra futárként belépve a /courier oldalon látszanak a futárhoz rendelt kiszállítások.

Ez csak a helyi fejlesztői bejelentkezést érinti; élesben mindenki a saját fiókjával lép be.

## Ételképek — v23

Az Ételkatalógusban minden étel kártyáján „Kép feltöltése” gomb van (cseréhez „Kép cseréje”, mellette kuka ikon a törléshez). A kép a katalógusban és az ügyfélportál étlapján is megjelenik. Feltöltés előtt a böngésző lekicsinyíti (legfeljebb 1200 px, WebP), így egy telefonfotó is gyorsan feltölthető. JPG, PNG vagy WebP tölthető fel; tulajdonos, admin és diszpécser kezelheti. A képek az adatbázisban vannak; új migráció: `0015_product_images`. Részletek: `src/modules/images/SPEC.md`.

## Olvashatóbb felület — v24

Nagyobb betűk és kevesebb üres hely az egész alkalmazásban (dolgozói munkatér, ügyfélportál, futárfelület). A korábban 8–12 px-es apró szövegek most 12–15 px-esek (például 9→12, 11→14, 12→15 px), az alapbetű 14 helyett 16 px; a nagyobb belső és külső térközök kb. 30%-kal kisebbek. Az elrendezés (menüsáv szélessége, töréspontok) nem változott.

## Mikorra mi kell? — v25

A Beszerzés oldal tetején új panel mutatja a következő 7/14/30 nap rendeléseihez napokra bontva, mi hiányzik a raktárból (például: „November 9., hétfő · 1 rendelés · 160 adag · 7 tétel hiányzik”). A számítás a recepteket (al-receptekkel), a raktárkészletet, a lejárati dátumokat és a már megrendelt, úton lévő beszerzéseket is figyelembe veszi, és a készletet napról napra fogyasztja, így egy tételt nem számol kétszer. Soronként látszik a hiányzó mennyiség, a csomagszám, a beszállító és a becsült költség. A „Beszerzési rendelés erre a napra” gomb kitöltött beszerzési rendelést nyit, a gyártás előtti napi határidővel.

## Egyszerűbb menüsáv és Beállítások — v26

A „Konyha Studio” felirat lekerült a menüsávról és a felső sávról. A szerepkör a bal alsó sarokban, a név alatt látszik. A felső sáv csak az aktuális oldalt mutatja; a beállítás-oldalaknál „Beállítások › …” formában. A Beállításokban az egész kártya kattintható, a „Megnyitás” gomb megszűnt, és a kártyák kisebbek, így több fér el egy képernyőn (telefonon két oszlopban).

## Kevesebb menüpont, étlap alapú portál — v27

- A „Leltár és korrekciók” a főmenü helyett a Beállításokban van.
- A Beállítások oldal „Modulok áttekintése” része nem ismétli meg a fenti beállítás-kártyákat, így minden csak egyszer szerepel.
- Az ügyfélportálon minden aktív étel rendelhető, amely rajta van az adott napi étlapon, a megadott adagszámig. A külön „Kínálat / közzététel” jelölés megszűnt (az Ügyfélportál oldalról és a végpontból is), az étlap az egyetlen feltétel. A nyilvános katalógus a mai vagy későbbi, nyitott étlapokon szereplő aktív ételeket adja.
- Az aktív ételek képe bejelentkezés nélkül is elérhető.

## Saját bejelentkezés és Cloudflare-telepítés — v28

A ChatGPT Sites bejelentkezés helyett saját fiókok vannak: a `/signin` oldalon e-mail-címmel és jelszóval lehet regisztrálni és belépni (HU/RO). A jelszavak sózott PBKDF2-kivonatként, a munkamenetek csak lenyomatként vannak az adatbázisban (30 napos, HttpOnly süti). 8 sikertelen próbálkozás után az e-mail 15 percre zárolódik. A tulajdonosi e-mail-címet csak titkos beállítókóddal lehet regisztrálni. Részletek: `src/modules/auth/SPEC.md`. Új migráció: `0016_auth_accounts`.

A helyi fejlesztői szerveren a próbafiókok (Seedy, Teszt Futár) továbbra is működnek; a belépőoldal alján linkként is elérhetők. Éles buildben nincsenek benne.

Feltöltés saját, ingyenes Cloudflare-fiókra: lépésenként a `TELEPITES.md` írja le (`npm run cf:setup`, `cf:migrate`, `cf:deploy`, `cf:secrets`).

## Saját címek a veres.no alatt — v29

Az alkalmazás a Cloudflare-en fut, három címen: `gastrogarage.veres.no` (ügyfélrendelés, a gyökér a `/portal`-ra irányít), `konyha.veres.no` (konyhai munkatér) és `courier.veres.no` (a gyökér a `/courier`-re irányít). Mindhárom ugyanaz a worker és ugyanaz az adatbázis (`konyha-db`); az átirányítást a `worker/index.ts` végzi a `PORTAL_HOST` / `COURIER_HOST` alapján. A címek a `cloudflare.json` `domains` részében vannak.

## Google-belépés, ideiglenes jelszó, erősebb belépés — v30

- Belépés Google-fiókkal (megjelenik, amint a Google-ügyfél be van állítva; lépések: `TELEPITES.md`).
- Elfelejtett jelszó: a tulajdonos/admin ideiglenes jelszót ad (Dolgozói hozzáférés, illetve Ügyfélportál-fiókok), első belépéskor kötelező új jelszót adni.
- Jelszó módosítása oldal (`/password`), a Beállításokból és a portál fejlécéből.
- Gyenge jelszavak tiltása, IP-alapú próbálkozás-korlát, biztonsági fejlécek, belépések naplózása.
- Új migráció: `0017_auth_google_reset`. Részletek: `src/modules/auth/SPEC.md`.

## Gastro-Garage logó, élő Google-belépés — v31

- A „konyha.” felirat és ikon helyett mindenhol a Gastro-Garage logó (háttér nélkül): konyhai oldalsáv, ügyfélportál, futár, belépés, jelszócsere, böngésző-ikon (`public/logo.png`, `logo-192.png`, `favicon-32.png`, `apple-touch-icon.png`).
- A Google-ügyfél azonosítója a `cloudflare.json`-ban; a Google-belépés élesben bekapcsolva.

## Fogyasztói címke QR-kóddal — v32

- Beállítások → Címkeadatok: gyártói adatok, alapértelmezett tárolás, ételenként fogyaszthatósági idő és tárolás.
- Napi munkaterv és csomagolás → Termékcímkék: adagonként egy román nyelvű címke (EU 1169/2011) 62 mm-es címkeszalagra: összetevők kiemelt allergénekkel, tápérték, nettó tömeg, gyártás napja, „A se consuma până la”, tételszám, tárolás, gyártó, QR-kód. A hiányzó adatokat ételenként jelzi.
- A QR-kód a nyilvános `/label?id=` oldalt nyitja meg (magyarul és románul, ügyféladat nélkül).
- A konyha és a portál láblécében is Gastro-Garage szerepel.
- Új migráció: `0018_product_labels`. Új csomag: `qrcode-generator`. Részletek: `src/modules/labels/SPEC.md`.

## Címke kijelölése nyomtatás előtt — v33

- A Termékcímkék nézetben te választod ki, melyik ételhez kell címke („Címke kell”), és hány példányban; csak a kijelöltek nyomtatódnak („Kijelölt címkék nyomtatása”).

## Hiányzó címkeadat pótlása — v34

- A Termékcímkék hiánylistájában az ételre kattintva felugró ablakban pótolható a fogyaszthatósági idő, a tárolás és a gyártói adat (tulajdonos/admin).

## Csomagolás külön, futár a csomagellenőrzésből — v36

- A „Napi munkaterv és csomagolás” helyett „Csomagolás”: csak Csomagellenőrzés és Termékcímkék. A munkacímke megszűnt; az adagterv (kész és csomagolt adag, allergének) az Áttekintésben van.
- Kiszállítás → Napi beosztás: naponta bejelölhető, melyik futár dolgozik.
- Csomagellenőrzés: ha hiányzik a futár, a beosztottak közül egy kattintással kiosztható (a legkevésbé leterhelt a javasolt); ha aznap nincs beosztott futár, a rendelés helyszíni átvételre váltható, a kiszállítási díj törléséről jelölőnégyzet dönt.
- Új migráció: `0019_courier_shifts`.

## Ügyfélportál oldal — v37

- A visszaigazolásra váró kérések listája kikerült (a Rendelések oldalon, a „Visszaigazolásra vár” szűrővel érhetők el); helyette ügyfélkereső van.
- Az Ügyfélportál kikerült a főmenüből; a Beállítások között érhető el (tulajdonos, admin, diszpécser).
- Rendelések: az egész sor kattintható; nagyobb gombok, mezők és sorok (konyhai, „zsíros ujjas” használatra).
- Áttekintés és Rendelések: az állapot az ügyfélportálhoz hasonló lépéssor (Rendelés elfogadva → Készül → Elkészült → Futárra vár / Átvehető → Úton → Teljesítve), kis lépésjelzővel; a lista 30 másodpercenként és az ablakba visszatéréskor magától frissül.
- Áttekintés: négy állapotkártya – Rendelés, Konyhai terv, Csomagolás, Futár – narancs (még nem kezdődött), sárga (folyamatban), zöld (kész) színnel; a rendelési érték lent, visszafogott sávban (fizetve / fizetésre vár).
- Fejléc: a modul neve már nem ismétlődik háromszor; a fejlécben minden modulból nagy „Vissza az Áttekintéshez” gomb van (annak, akinek van Áttekintés oldala).
- Szerepkörök: nincs külön raktáros; a konyha látja az Áttekintés összes részét (rendelések, konyha, csomagolás, kiszállítás), és kezeli a raktárt, a leltárt és a beszerzést.
- Álló képernyőn (magasabb, mint széles) és 900 px alatt mobil elrendezés: a bal oldali menü elrejtve, a ☰ gombbal nyílik. Kiszállítás: az egész kártya megnyitja a rendelést, a külön Megnyitás gomb megszűnt.
- Futár munkatér: sötétzöld, fix fejléc a logóval és a nagy „Futár munkatér” címmel (alatta a futár neve), nagyobb betűk, nagy gombok (indulás, kézbesítve teljes szélességben), kiemelt napi összesítő.
- Ügyfélportál: modern, mobilbarát étlap – nagy képes kártyák, „i” gomb az allergénekhez és összetevőkhöz (felugró ablak), jól látható narancs „Kosárba” gomb, darabszámláló, telefonon alsó kosársáv, görgethető nap- és kategóriaválasztó.

## Ügyfélportál: csak a nyitott rendelések — v45

- A kiszállított és átvett rendelések eltűnnek az ügyfél „Saját rendeléseim” listájáról; a lemondott és elutasított kérések a lezárás után 1 napig még látszanak. Új migráció: `0020_audit_entity_index`.

## Konyhai kijelző régi eszközre (IE11) — v47

- Új, különálló oldal: `https://konyha.veres.no/kijelzo`. Szerveren renderelt HTML és ES5 script, ezért első generációs Surface RT-n (Windows RT 8.1, Internet Explorer 11) is fut. A fő alkalmazás nem változik.
- Belépés űrlappal, a meglévő dolgozói fiókkal (konyha vagy admin); a belépés 30 napig érvényes, és használat közben megújul.
- Mai és késésben lévő rendelések nagy kártyákon, nagy „Folyamatban” / „Elkészült” gombokkal; villogás nélküli frissítés 07–19 óra között 5, éjjel 30 mp-enként (változatlan adatnál a szerver üres választ ad); új rendelés kiemelése és csengő; „Nincs kapcsolat” jelzés és automatikus újrapróbálás. HU/RO.
- Új migráció: `0021_order_lookup_indexes` (`orders(date,status)`, `order_items(order_id)`).
- A Surface RT beállítása (külön Konyha fiók, automatikus bejelentkezés, IE11 kioszk mód): `scripts/surface-rt/LEIRAS.md`.
- Részletek: `src/modules/display/SPEC.md`.

## Konyhai kijelző: egy gombos elfogadás — v48

- A még el nem kezdett rendelésen egyetlen nagy zöld „Elfogadom ✓” gomb van („Kérés visszaigazolása, főzés indul”): visszaigazolja a portálos kérést, és a főzést is elindítja. Utána csak az „Elkészült” gomb marad; a külön „Folyamatban” gomb megszűnt.
- A kijelző a visszaigazolásra váró mai kéréseket is mutatja (zöld keret). A konyha a kijelzőn visszaigazolhat, elutasítani nem tud.

## Napi menü és Étlap — v49

- Az Ételkatalógus két fülre oszlik: **Napi menü** (leves, főétel, desszert) és **Étlap**. Új ételnél választható a rész, a meglévők egy gombbal áthelyezhetők.
- Mértékegység: levesnél ml, minden másnál g (katalógus, portál, címke).
- Napi / heti étlap: a napi menü állandó ára, és naponta a menü levese, főétele és desszertje.
- Ügyfélportál: „Napi menü” kártya egy áron. A Napi menü ételei csak a menü részeként rendelhetők, külön csak az Étlap ételei. A rendelésben a menü egy sorként látszik, a konyha viszont a valódi ételeket kapja.
- Új migráció: `0022_daily_menu_set`.
- Részletek: `src/modules/menu/SPEC.md`.

## Egyszerűbb rendelési szabályok — v50

- A heti idősávoknál megszűnt a „rendelések száma / nap” korlát (mező, ellenőrzés, adatbázis-trigger). A minimális rendelési összeg megmaradt.
- Ügyfélportál: csak mai napra lehet rendelni; a napválasztó eltűnt.
- Főzés előtti lemondáskor (ügyfél vagy konyha/diszpécser) a rendelés és minden adata véglegesen törlődik, a naplóból is.
- Új migráció: `0023_drop_slot_capacity_trigger`.

## Egy futár, egyszerűbb kiszállítás — v51

- Megszűnt a futártörzs, a fiók–futár összekötés, a napi futárbeosztás, a rendelésenkénti futár-hozzárendelés és a napi futárlista.
- Aki futár szerepkört kap, a futár oldalon az összes kiszállítást látja; induláskor az ő neve kerül a rendelésre.
- Új migráció: `0024_remove_courier_registry` (a rendelések táblája újraépül `courier_id` nélkül; az adatok megmaradnak).
