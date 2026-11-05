# Könyvelési profil

Az adminisztrátor a Beállítások → Könyvelési szabályok nézetben alkalmazza a könyvelő által egyeztetett profilt. A cég neplătitor de TVA státusza és a megerősített mentességi megjegyzés a profil adata. Az Oblio/SPV integráció továbbfejlesztése későbbi munkaszakasz.

A profil alkalmazása egy D1-kötegben menti a profilt, a naplóbejegyzést és a három működési beállítást. Új bevételezések bruttó értéken történnek, a gyártás lezárása BP-t készít, kiszállításhoz aviz kell. A korábban kiállított bizonylatokat és készletértékeket a profil nem számolja újra. A kezdőnap az első alkalmazás Europe/Bucharest szerinti dátuma, későbbi megjegyzésmódosításkor is megmarad.

## Határok és jogosultság

GET `/api/accounting` és POST `/api/accounting/profile` csak adminisztrátornak vagy tulajdonosnak érhető el. Minden mentés revision-ellenőrzést használ. Elavult kérés esetén az összes változás visszagörgetődik. Az alkalmazott profillal ellentétes működési beállításokat adatbázis-triggerek tiltják, így a régebben megnyitott beállítási lap sem írhatja felül a szabályt.

## Ellenőrzési példák

- Nettó bevételezés, kikapcsolt BP és aviz esetén egyetlen profilalkalmazás bruttó/igen/igen beállítást eredményez. A NIR-bizottság, a ráhagyás és a PV-aláírók megmaradnak.
- Két admin ugyanazzal a revisionnel ment. Az egyik sikerül, a másik 409-et kap. A második kérés nem növeli a modulbeállítások revisionjét.
- Profilalkalmazás után a régi NIR ugyanazt az értéket mutatja. Az új, 121 lej bruttó beszállítói tétel 121 lejes bekerülési értékkel kerül be.
- Az aktív profil mellett a nettó készletértékelés, a BP kikapcsolása és a kötelező aviz kikapcsolása érthető hibát ad.

## Heti és havi kimutatások

GET `/api/accounting/report?kind=week&value=YYYY-MM-DD` a kiválasztott nap hétfő–vasárnap hetének BC-összesítőjét adja. A hónapos változat `kind=month&value=YYYY-MM` a havi csomagot állítja össze. Mindkét végpont csak adminisztrátornak és tulajdonosnak érhető el. A nézet román nyelvű, önálló nyomtatható HTML, amelyből a böngésző PDF-et menthet.

A BC-ket a kiállítási nap szerint összesítjük. A később sztornózott eredeti az eredeti időszakban szerepel, a negatív sztornó a saját dátumán. Mennyiség, név és érték a pillanatképből származik. A havi részhetek a hónap első és utolsó napjához vágódnak.

A havi csomagban belső bizonylatjegyzék, heti BC-k, költségösszesítő és költségbejegyzések, NIR, BC, BP, selejt-PV, aviz, meglévő Z-adatok, pénztárkönyv, konyhai zárások és az alkalmazásban kézbesített rendelések tételei szerepelnek. A különböző kimutatások összegeit külön jogcímen közöljük. A naplózott költségek és a sztornók saját rögzítési dátumuk szerint kerülnek bele.

Az eredeti beszállítói mellékletek és a már elérhető kimenő számlák a mellékletjegyzékből külön megnyithatók. Ezek külön nyomtatandók, az eredeti Z/POS és bankszámlakivonatokkal együtt. A csomag jelzi a hiányzó beszállítói fájlt, a piszkozatokat, a nyitott gyártási tételeket és a hiányzó konyhai zárásokat. Ez ellenőrzési csomag, a könyvelői átvétel külön történik.

Az átadási határidő a következő hónap 10-e. A nyomtatási kérés olvasási művelet, bizonylatot és készletmozgást nem hoz létre. A túl nagy csomag hibával leáll a részleges, észrevétlen kivágás helyett.

## Kimutatási ellenőrzések

- Október 31-i BC és november 5-i sztornó esetén az októberi összeg pozitív, a novemberi korrekció negatív, együtt nulla.
- Hónapváltó heti listában a havi csomag csak a kiválasztott hónap napjait tartalmazza.
- A decemberi csomag átadási határideje a következő év január 10-e.
- A jelentés megnyitása és újranyomtatása nem változtatja a készletet és a költségnyilvántartást.
