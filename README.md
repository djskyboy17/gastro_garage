# Konyha – rendelés, receptúra és raktár

Nyilvános tesztalkalmazás: https://konyha-catering-zsolt.tinykoi1025.chatgpt.site. Az adatkezeléshez ChatGPT-belépés szükséges. Az adatkészlet közös a bejelentkezett tesztelőknek; dolgozói szerepkörök még nem készültek el.

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

## Még tervezett

Dolgozói jogosultságok; alreceptek és tápérték; beszállítói megrendelések és NIR; HACCP; számlázás/e-Factura; futárhozzárendelés; útvonaltervezés; ügyfélportál; offline működés; korrekciós/visszafordító műveletek. A jelenlegi változat tesztelésre szolgál.

## Technikai alap

TypeScript + React + Vinext; Drizzle; Sites D1/SQLite. Ez eltérés az eredeti PostgreSQL-javaslattól: a gyors, privát kipróbálást szolgálja. A PostgreSQL-váltás külön adaptert és üzemeltetési döntést igényel. A kód egy alkalmazásban marad. A szabályok: AGENTS.md; jelenlegi specifikáció: src/modules/shared/SPEC.md.

## Fejlesztői ellenőrzések

`node node_modules/typescript/bin/tsc --noEmit`

`node --experimental-strip-types --test tests/domain.test.mts tests/inventory.test.mts`

Helyi szerverrel: `node tests/api-smoke.mjs` és `node tests/inventory-api.mjs`. Ezek kizárólag a helyi adatbázisba írnak tesztadatokat.

`npm run build`

Helyi előnézet: `npm run dev`. Helyi belépés: `/signin-with-chatgpt?return_to=/`. A helyi és a közzétett adatbázis különálló. A helyi D1-migrációhoz a Sites starter README-jét kövesd. A mintafeltöltés csak az aktuális környezetbe ír; a helyi tesztadatok nem kerülnek a közzétett változat adatbázisába.
