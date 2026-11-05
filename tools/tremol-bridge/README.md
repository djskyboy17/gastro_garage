# Gastro Garage és Tremol S25 Windows-kiegészítő

Egy román Tremol S25-höz egy Windows-gép és Windows-fiók tartozik. A webalkalmazás a rendelés mentett tételeit és tervezett készpénzes/kártyás módját adja át. A pénz tényleges átvétele külön művelet az alkalmazásban.

## Beállítás

1. Másold a teljes mappát a kasszás gépre, majd futtasd a `Telepites.cmd` fájlt. Frissítéskor a programfájlok cserélődnek; a helyi settings.json és journal megmarad. Telepítés nélkül az `Inditas.cmd` használható Windows PowerShell 5.1 alatt.
2. Telepítsd a román **Tremol ZFP SDK RO** Windows ZFPLabServerét és a megfelelő USB-illesztőt. A ZFPLabban a saját COM-port és adatsebesség kell. A kiszolgáló helyi maradjon. Hivatalos források: [ADPOS letöltőközpont](https://adpos.ro/adpos-download-center), [Tremol RO SDK](https://tremol.bg/en/support/zfplab/RO/2601151250). A helyes csomagot és készülékbeállítást szükség esetén a szerviz ellenőrzi.
3. A `Kasszateszt.cmd` csak olvas: verzió, sorozatszám, TVA-kulcsok, fizetésihely-nevek.
4. A `%LOCALAPPDATA%\GastroGarage\Tremol\settings.json` alapból preview módú. Add meg a tényleges sorozatszámot, kezelőt, jelszót, cash/card slotot és annak pontos nevét. A jelszó helyi marad.
5. A `vatByProduct` a termékazonosítóhoz rendeli a kasszában jóváhagyott TVA-betűt és százalékot; a `deliveryVat` a szállítási díjé. A nem áfafizető céghez a szervizzel/könyvelővel egyeztetett, ténylegesen beprogramozott besorolás szükséges. Nincs automatikusan feltételezett kulcs. A név legfeljebb 30 karakteres román kasszanév lehet. A szerkezet: `"termek-id": { "class": "A", "rate": 0, "name": "Denumire" }`; a példa nem készülékbeállítási javaslat.

## Webalkalmazás és nyugta

A Pénztár → Egyetlen konyhai kassza beállítása alapmódja szimuláció. Ez a webes próbákat menti, a készüléket nem éri el. Valódi használathoz adminisztrátor állítja live módra a webalkalmazást a kiolvasott sorozatszámmal; a híd saját mode beállításának is live-nak kell lennie. Csak az egyik átállítása nem elég.

1. A rendelés részleteiben válassz és ments tervezett fizetési módot. Csak mai, visszaigazolt rendelés készíthető elő.
2. Nyugtafájl előkészítése → Tremol-nyugtafájl letöltése. A `.gastrobon` tíz percig indítható. Nyisd meg az `Inditas.cmd` programmal. Preview módban csak előnézet készül.
3. Live módban a kezelő ellenőrzi és jóváhagyja a nyugtát. A híd összeveti az eszközt, TVA-kulcsokat, fizetésihely-nevet és részösszeget, majd a zárás után a nyugtaszámot és számlálót visszaolvassa.
4. Az eredeti `.gastrobon` mellett `.gastroresult` készül. A rendelés Konyhai kassza részén olvasd be, ellenőrizd, majd mentsd. Ez a lépés viszi vissza az eredményt az alkalmazásba; nincs automatikus háttérkapcsolat.
5. A pénz átvételét a Fizetés részen külön rögzítsd. A nyugta visszaigazolása önmagában nem jelöl fizetettnek.

## Kiesés és egyeztetés

A journal bejegyzés a kiadás megkezdése előtt lemezre kerül. Elveszett zárási válasznál bizonytalan eredmény készül, és a híd blokkolja a további kiadást. Ne indítsd újra ugyanazt a nyugtát. A `journal` mappát gépcsere esetén is meg kell őrizni.

Ha az eredményfájl elveszett, az `Eredmeny.cmd` a helyi naplóból újra exportálja. Sikeres nyugtához az `.issued` bejegyzést válaszd; a sima `.pending.json` a bizonytalan állapotot exportálja.

A kassza elektronikus naplójának ellenőrzése után az admin a webalkalmazásban rögzíti, hogy a nyugta kiadásra került-e. Nem-kiadás csak a korábbi fájl lejárata és még egy perc után rögzíthető. Töltsd le az egyeztetési `.gastroresolution` fájlt, majd a kasszás gépen az `Egyeztetes.cmd` programmal alkalmazd a helyi naplóhoz. Egy már helyben igazolt nyugta nem minősíthető át nem-kiadottnak. Az egyeztetés nem törli az eredeti naplót.

Kifejezett új próbát kizárólag ellenőrzött nem-kiadás és mindkét napló rendezése után indíts új feladatként. Nincs automatikus újranyomtatás. Kézi kasszakezelés után ugyanazt a rendelést ne add ki újra a híddal.

A fájlok csak a feladat- és kasszaadatokat tartalmazzák, kiszállítási személyes adatot nem. A korrelációs token nem helyettesíti a kasszanapló ellenőrzését. Eredményt csak bejelentkezett, jóváhagyott irodai dolgozó menthet az alkalmazásba.

## Ellenőrzött és még ellenőrizendő

A szoftveres tesztek helyettesített SDK-parancsokkal ellenőrzik a sikert, megszakítást, duplázás elleni védelmet, az eredményfájlokat és az egyeztetés utáni kifejezett új próbát. A saját S25 fizikai USB-kapcsolata, firmware/SDK-változata, beprogramozott TVA- és fizetésihely-beállításai készüléken végzendő próbát igényelnek. Z-zárás és bankkártyás POS-fizetés nem indul ettől a kiegészítőtől.
