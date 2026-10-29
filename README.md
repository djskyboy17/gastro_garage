# Konyha – első fejlesztési változat

Az alkalmazás a munkakönyvtárban található. Privát Sites-alkalmazásként készül; a bejelentkezést a Sites kezeli.

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

## Még tervezett

Dolgozói jogosultságok; teljes receptúra és tápérték; raktár, tételek, lejáratok; beszerzés; HACCP; számlázás/e-Factura; futárhozzárendelés; útvonaltervezés; ügyfélportál; offline működés. Az első változat belső prototípus, éles üzemi bevezetés előtt ezek és a valós munkafolyamatok egyeztetése szükséges.

## Technikai alap

TypeScript + React + Vinext; Drizzle; Sites D1/SQLite. Ez eltérés az eredeti PostgreSQL-javaslattól: a gyors, privát kipróbálást szolgálja. A PostgreSQL-váltás külön adaptert és üzemeltetési döntést igényel. A kód egy alkalmazásban marad. A szabályok: AGENTS.md; jelenlegi specifikáció: src/modules/shared/SPEC.md.

## Fejlesztői ellenőrzések

`node node_modules/typescript/bin/tsc --noEmit`

`node --experimental-strip-types --test tests/domain.test.mts`

`npm run build`

Helyi előnézet: `npm run dev`. Helyi belépés: `/signin-with-chatgpt?return_to=/`. A helyi és a közzétett adatbázis különálló. A helyi D1-migrációhoz a Sites starter README-jét kövesd. A mintafeltöltés csak az aktuális környezetbe ír; a helyi tesztadatok nem kerülnek a közzétett változat adatbázisába.
