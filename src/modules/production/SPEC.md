# Gyártási tétel és bon de consum (v73, 2. fázis)

A konyhai gyakorlat (2026-11-03-i egyeztetés):
- ételenként **egy gyártási tétel naponta** (egyszerre főzik a nap összes adagját);
- mennyiség: **a rendelések + ráhagyás**, a végén a tényleges adagszám rögzül;
- „Kész” jelölés gyártási tétel nélkül: **figyelmeztetés**, nem tiltás;
- a gyártást **az iroda / admin rögzíti** (akár utólag, másnap is).

## Adatok
- `production_batches`: nap + étel egyedi. Tételkód = a címke eddigi tételszáma (`lotCode(nap, étel)`, pl. `L261104-6TXY`), így a régi és az új címkék egyeznek. Receptpillanatkép: a receptváltozat azonosítója és a felhasznált al-receptváltozatok azonosítói (a változatok nem módosíthatók, így az azonosító maga a pillanatkép). Mezők még: rendelt, tervezett, tényleges adag, rendelésenként korábban kiadott adag, fogyaszthatóság, megjegyzés, állapot (`open` / `closed`), változat.
- `consumption_documents`: bon de consum, sorozat `consumption` (előtag `BC`, pl. BC-2026-0001), a `documents` modullal, a tétellel egy kötegben foglalt, hézag nélküli számmal. Pillanatkép: étel, tételkód, adagok, receptváltozat, megjegyzés, alapanyagonként recept szerinti és felhasznált mennyiség, raktári tételek (lot, lejárat, mennyiség) és érték.
- `production_settings`: a ráhagyás bázispontban (alapértelmezés 10%), az admin állítja. [FELTÉTELEZÉS] egy közös ráhagyás minden ételre.
- `stock_moves.batch_id`: a tétel kiadása (`production`, negatív) és sztornója (`production_reversal`, pozitív).

## Működés
- **Felvétel / mentés** (`POST /api/production/save`): nyitott tétel a javasolt (rendelt + ráhagyás, felfelé kerekítve) vagy beírt adaggal. Nyitott tétel mentésekor a receptpillanatkép a legfrissebb receptre frissül. Recept nélküli (vagy hiányzó al-receptű) ételhez nem vehető fel tétel.
- **Törlés** (`/delete`): csak nyitott, bizonylat nélküli tétel.
- **Anyaglista** (`GET /api/production/preview`): a tétel receptpillanatképéből, a tényleges adagszámra, a rendelésenként már kiadott adagokat levonva; mellette az aznap felhasználható készlet.
- **Lezárás** (`/close`): a sorok pontosan a recept alapanyagai; a felhasznált mennyiség átírható (0 is), eltérésnél indoklás kell. FEFO a gyártási napon érvényes raktári tételekből. Egy D1-kötegben: napló (változat-ellenőrzéssel), BC-szám, BC, raktári levonás és mozgás, tétel lezárása. Hiány esetén semmi nem íródik. Jövőbeli nap nem zárható le. Ha minden felhasznált mennyiség 0, BC nem készül.
- **Sztornó** (`/reverse`, indoklással): sztornó-BC (negatív sorok, saját sorszám, a sztornó napjával), a mennyiségek ugyanazokba a raktári tételekbe kerülnek vissza, az eredeti BC „sztornózva”, a tétel újra nyitott. A BC-k megmaradnak.
- **Nyomtatás** (`GET /api/production/bc?id=`): román „BON DE CONSUM” oldal.
- Minden végpont csak adminnak (tulajdonos / admin).

## Kettős levonás kizárása
- Ha egy ételhez az adott napra gyártási tétel van (nyitott vagy lezárt), arra a napra rendelésenként nem adható ki anyag olyan rendeléshez, amelyben ez az étel szerepel (`ISSUE_BATCHED`, a kötegen belül is ellenőrizve).
- A tétel lezárásakor a rendelésenként korábban kiadott adagokra nem fogy újra anyag (`issued_before`).
- A beszerzési terv és az előretekintő terv a lezárt tétel ételét az adott napon fogyottnak tekinti.

## Konyha, áttekintő, címke
- A konyha „Kész” gombja nem változott.
- Admin az Áttekintőn és a Konyhai terven figyelmeztetést lát azokról az ételekről, amelyekből van kész adag, de nincs lezárt tételük (és nem rendelésenként adták ki őket). Recept nélküli ételre nem figyelmeztet.
- Címke: ha van tétel, a tételkód, a fogyaszthatóság (lezáráskor a címkebeállítás eltarthatóságából számolva) és az összetevők a tétel receptpillanatképéből jönnek. Tétel nélkül a régi működés marad.
- Felület: Konyhai terv → Gyártási tételek (napválasztó, ráhagyás, ételenként rendelt / javasolt / tervezett / tényleges adag, anyaglista és lezárás, BC-linkek, sztornó).

## Nincs benne (3. fázis)
- Késztermék-készlet (megmaradt adagok), maradék, selejt, dolgozói étkezés. A tényleges adagszám már rögzül, erre épül.
- Több tétel naponta egy ételből.

## Ellenőrző példák (tests/production.test.mts)
1. Gulyásleves, 40 rendelt adag, 45 tényleges: 45 adagnyi alapanyag FEFO szerint, értékkel.
2. Egy korábban rendelésenként kiadott 5 adagos rendelés miatt a tétel csak 40 adagnyit ad ki.
3. Kevés készlet vagy lejárt tétel: a lezárás nem megy át.
4. BC sztornó: minden mennyiség és érték ellentétes előjellel, ugyanazokra a raktári tételekre; a nyomtatás „STORNO la …”.
5. A tétel receptpillanatképe a rögzített al-receptváltozatot tartja meg, akkor is, ha közben új változat készült.
6. „Kész” lezárt tétel nélkül figyelmeztet; lezárt tétel után nem, és a beszerzési terv sem számolja újra.

---

# 3. fázis: készétel-készlet, maradék, selejt (v74)

Egyeztetés (2026-11-03):
- a maradék adag **másnap eladható**, vagy **dolgozói étkezés**, **selejt** vagy **adomány** lesz;
- a nap végén **a konyha rögzíti**;
- selejt: **napi összesítő proces-verbal** (PVC sorozat);
- bon de predare (a kész étel bevétele a készletbe): **még nem tudni** → beállítás, alapból kikapcsolva. [ELLENŐRIZENDŐ] a könyvelővel.

## Adatok
- `finished_moves`: a napi záráskor rögzített kiadás tételenként (`sold`, `staff`, `waste`, `donation`). A tétel készlete = tényleges adag − a korábbi napok mozgásai.
- `production_day_closes`: naponta egy sor (`open` / `closed`, változat, a lezárt nap sorai pillanatképként, a selejt-PV azonosítója).
- `production_documents`: selejt-PV (sorozat `write_off`, PVC-…) és bon de predare (sorozat `handover`, BP-…), sztornóval.
- `production_settings`: + a PV aláírói, + a bon de predare kapcsoló.

## Végpontok
- `GET /api/production/day?date=`, `POST /api/production/day/close`, `GET /api/production/doc?id=`: admin és konyha.
- `POST /api/production/day/reopen` (indokkal), `POST /api/production/settings`: csak admin.

## Készétel-készlet
- A lezárt gyártási tétel tényleges adagjai a **készétel-készletbe** kerülnek, tételenként (tételkód, fogyaszthatóság). A BC sztornója a készletből is visszaveszi, amíg abból még nem adtak ki.
- **Eladás:** a nap visszaigazolt rendeléseinek adagjai fogynak, a legrégebbi még fogyasztható tételből először (a tegnapi maradékból, utána a mai főzésből).
- A gyártási tételnél a javasolt adag **levonja a tegnapról megmaradt, még fogyasztható adagokat**: 40 rendelés, 6 maradék → javasolt (40 − 6) + ráhagyás.

## Napi zárás (konyha)
- Ételenként: **nyitó** (előző napi maradék) + **gyártott** = **eladott** + **dolgozói** + **selejt** + **adomány** + **záró** (másnapra marad).
- A konyha a dolgozói, selejt és adomány adagot írja be (selejtnél indokkal); a záró adagot a rendszer számolja, és nem lehet negatív. Ha a valóságban más maradt, a konyha a selejttel vagy a dolgozói adaggal igazít, nincs „eltűnt” adag.
- Lejárt adag nem maradhat a készletben: a fogyaszthatósága után csak selejt lehet (figyelmeztetés, ha a záráskor maradna).
- A zárás után a nap nem módosul; tévedésnél az admin visszanyitja (napló, a PV sztornójával, a nap mozgásai törlődnek). Későbbi lezárt nap esetén előbb azt kell visszanyitni.
- Lezárni csak akkor lehet, ha a napon nincs nyitott gyártási tétel, és a korábbi napok le vannak zárva. [FELTÉTELEZÉS] Nem kell lezárni azt a korábbi napot, amelyen nem volt sem lezárt tétel, sem (kiadható maradék mellett) rendelés – pl. vasárnapot.
- Lezárt napra nem vehető fel, nem zárható le és nem sztornózható gyártási tétel; a BC sztornója akkor sem megy, ha a tételből már kiadtak (`BATCH_HAS_MOVES`) – előbb a nap visszanyitása kell.
- Recept nélküli étel (pl. üdítő) és a régi, rendelésenként kiadott rendelés nem a készletből fogy, ezért nincs a napi zárásban.
- Fogyaszthatósági idő nélkül a tétel csak a gyártás napján adható ki (a maradékot aznap selejtként vagy dolgozói étkezésként kell kiadni).

## Selejt: napi proces-verbal de casare
- A napi zárással egy **sorszámozott PV** készül (PVC-2026-0001), román nyomtatási képpel. Tartalma: étel, tételkód, adag, indok, **érték** (a tétel BC-értéke / gyártott adag), aláírók (beállítható nevek, mint a NIR-bizottság).
- Sztornó: csak admin, sztornó-PV-vel, az adagok visszakerülnek a készletbe.

## Címke
- Ha egy rendelés adagja egy korábbi napi tételből fogy, a címkén **annak a tételnek** a kódja, gyártási napja és fogyaszthatósága szerepel (a régebbi tétel adagjait a korábban leadott rendelések kapják). Ha egy rendelési tétel két tételre esik, két címke készül a saját darabszámával. A korábbi napok maradékát a címke csak akkor veszi figyelembe, ha azok a napok le vannak zárva.

## Bon de predare (beállítható, alapból ki)
- Bekapcsolva a tétel lezárásakor sorszámozott bon de predare is készül (gyártott adag, érték a BC-ből). [ELLENŐRIZENDŐ] a könyvelővel: kell-e, és milyen sorozattal.

## Felület
- **Konyha → Napi zárás** (a konyhai szerepkörnek is): ételenként nyitó / gyártott / eladott, három beírható mező (dolgozói, selejt + indok, adomány), számolt záró, „Nap lezárása”.
- Admin: PV-linkek, visszanyitás, aláírók, bon de predare kapcsoló.

## Ellenőrző példák (tests/finished.test.mts)
1. 100 adag gyártva, 80 eladva, 5 selejt, 15 marad → az egyenleg egyezik, PV 5 adaggal és értékkel, az alapanyag nem fogy újra.
2. Másnap 40 rendelés, 15 a maradék → javasolt (25 + ráhagyás); a 15 legkorábbi rendelés címkéjén a tegnapi tételkód áll.
3. A záró adag nem lehet negatív; lejárt maradék csak selejt lehet.
4. PV sztornó: az adagok visszakerülnek a készletbe, sztornó-PV készül.
5. Bon de predare kikapcsolva: nem készül; bekapcsolva: tételenként egy, sorszámmal.

## Nap lezárása recept szerint — v78
- A Gyártási tételeknél egy gomb (`POST /api/production/close-all {date}`, admin) a nap minden recepttel rendelkező, még nem lezárt ételét felveszi (ha kell) és lezárja: adagszám a nyitott tétel tervezett adagja, különben a rendelt adag; az anyagkiadás pontosan a recept szerinti (eltérés esetén az ételt előbb egyenként kell lezárni).
- Ételenként külön köteg: ami nem zárható le (pl. kevés a készlet), az kimarad az okával (az új tétel nyitva marad), a többi lezárul. Ismételt futtatás nem zár le semmit kétszer. Recept nélküli étel (pl. üdítő) nem szerepel.
- Ugyanazokkal a szabályokkal fut, mint az egyenkénti lezárás (közös függvény): jövőbeli nap és lezárt nap tiltva, FEFO, bon de consum, bon de predare.

## Könyvelési profil

A profil alkalmazása a bon de predare kiállítását kötelezővé teszi. Pozitív tényleges adagszámú tétel véglegesítésekor az anyagfelhasználás, a BC és a BP egy kötegben mentődik. A profil alkalmazásával versenyző lezárásnál a BP hiányát adatbázis-trigger ellenőrzi, hiba esetén az egész köteg visszagörgetődik. A régebben lezárt tételek bizonylatai megmaradnak.

## Napi anyagkiadás – 2026-11-06 (aktuális működés)

A gyártási tétel closed állapota most az elkészült adagszám rögzítését jelenti. Az új tétel production_materials sora külön tartalmazza a rögzített receptváltozat, alrecept-változatokból számolt igény, tényleges felhasználás és adagok pillanatképét. consumption_id=NULL esetén még nem történt nyersanyagkönyvelés. Régi tételnél nincs ilyen sor: annak korábbi BC-je változatlanul történeti bizonylat.

POST /production/close és /close-all kész adagot ment, stock_lots/stock_moves/BC módosítása nélkül. Hiányzó lines esetén a rögzített recept szerinti mennyiség kerül a pillanatképbe. A korábbi kliens kézi anyageltérése is elfogadható a korábbi validációval/indoklással. A felületen egyszerű adagszámmentés van; rendelés nélküli étel is felvehető. A késztermék-lot a korábbi closed alapú címke/aviz/kiszállítási folyamatban rögtön elérhető.

POST /production/day/close a revision mellett materialToken előnézetazonosítót is kér. A token az adott és a releváns korábbi napok gyártását, a halasztott pillanatképek változatát, a napi rendelések változatát, a zárási napok és a gyártási beállítás változatát ellenőrzi. Az előnézet olvasás közbeni változását is elutasítjuk. A tranzakció újra ellenőrzi a tokent és minden felhasznált nyersanyaglot egyenlegét. Összes halasztott tételhez közös FEFO-kiosztás, egy consumption_documents bizonylat, tételenkénti készletmozgás és – ahol beállított – BP készül. A BC napi sorai összegzettek, dailyBatches melléklete a tételeket és értéküket azonosítja; a kötelező batch_id az első tétel technikai hivatkozása, nem az egyetlen érintett étel. Minden érintett gyártási tétel és halasztott sor ugyanarra a napi BC-re hivatkozik.

A teljes nap, a nyersanyagfogyasztás, a BP és a késztermékmozgások egy D1.batch tranzakcióban véglegesülnek. Hiány/stale token vagy bármelyik SQL-hiba esetén semmi nem könyvelődhet részlegesen. A napi anyaglista nagy méreténél (90 kB BC-pillanatkép vagy 850 anyag/BP-utasítás fölött) a művelet érthető hibával, levonás nélkül megáll; nincs részleges/szétdarabolt napi zárás.

A stock_issues szerinti korábbi kiadást már az adagszám mentésekor levonjuk az új anyagigényből; napi véglegesítéskor a korábbi kiadott adagok változatlanságát is vizsgáljuk. A régi, production_materials nélküli gyártást soha nem könyveljük újra. A készétel selejtje a saját tételének napi BC-ben rögzített önköltségét használja, nem az egész napi BC teljes értékét.

Újranyitás csak a korábbi admin/sorrendi feltételekkel: a napi BC és a napi BP-k sztornózása, a napi termékmozgások visszavonása és a felhasznált nyersanyag visszaadása atomikus. Az elkészült adagok megmaradnak, a halasztott anyagok újra könyvelésre várnak. Újrazárás új napi BC-t állít ki; a korábbi BC-k és sztornók megmaradnak. Napi BC-ben szereplő tétel külön sztornója tiltott, előbb a napot kell visszanyitni. A régi tételenkénti BC sztornója továbbra is a korábbi módon működik.

A bon de predare az új halasztott tételnél a napi anyagkiadáskor készül végleges anyagértékkel. A könyvelési profil tétellezárási triggerének kivétele kizárólag a production_materials-ban már rögzített, még nem könyvelt tételre vonatkozik. Lezárt napra új tétel vagy mennyiség/recept/állapot módosítása adatbázisszinten is tiltott.

Elfogadás: rendelés nélkül 7 és 11 adag, adagonként 10 g közös alapanyag. Mentés után a 100 g nyersanyag változatlan és aviz kiállítható; napi zárás hiánnyal teljesen megáll. 100 g pótlás után egyetlen BC 180 g / 1800 bani, 20 g marad. Dupla/egyidejű zárásból csak az egyik sikerül. Újranyitás 200 g-ra állít vissza, újrazárás ismét 20 g-ra. A napi BC az admin napi zárási nézetéből, mobil HU/RO felületen is megnyitható.
