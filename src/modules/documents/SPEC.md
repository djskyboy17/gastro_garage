# Bizonylatok és sorszámozás — v71

Közös alap a román bizonylatokhoz (NIR, bon de consum, aviz, számla, chitanță, selejtezési jegyzőkönyv). Ebben a fázisban csak a sorszámozás készül el; a bizonylatokat a következő fázisok építik rá (lásd `FEJLESZTESI-TERV.md`).

## Alapelvek (minden bizonylatra)
1. **Végleges bizonylat nem módosítható és nem törölhető**, csak sztornózható / korrigálható; az eredeti és a javítás is megmarad. A rendelés nyomtalan törlése (főzés előtti lemondás) csak addig megengedett, amíg nincs hozzá bizonylat.
2. **Sorszám bizonylattípusonként és évenként**, hézag nélkül.
3. **Pillanatkép:** a bizonylat a kiállításkori adatokat őrzi (partner, tétel, mennyiség, ár, TVA, tételszám).
4. **Hivatalos bizonylat románul**, nyomtatható.

## Sorszámozás
- Tábla: `document_series` (kulcs `típus:év`, előtag, következő szám). Típusok és alapértelmezett előtagok: `nir` → NIR, `consumption` → BC, `delivery_note` → AVZ, `invoice` → FCT, `receipt` → CHT, `write_off` → PVC. [ELLENŐRIZENDŐ] a könyvelővel; az előtag sorozatonként átírható lesz.
- Kiírás: `ELŐTAG-ÉV-szám`, legalább 4 jegyre kiegészítve (NIR-2026-0001). Az év a bizonylat román naptári napja szerint; évente 1-ről újrakezdődik.
- Foglalás: `allocateDocumentNumber(típus, nap)` két utasítást ad (sorozat létrehozása, ha nincs; számláló növelése) és egy SQL-részletet a most foglalt számhoz. Ezeket a bizonylatot beszúró utasításokkal **egy D1-kötegbe** kell tenni: ha a köteg elbukik, a számláló sem nő, így nincs kihagyott szám, és két egyszerre kiállított bizonylat sem kaphat azonos számot.
- A bizonylat a sorozat kulcsát (típus, év) és a számot egészként tárolja; a kiírt alakot a megjelenítés állítja elő.

## Ellenőrző példák
1. Két egymás utáni NIR 2026-ban: NIR-2026-0001, NIR-2026-0002; az első BC ugyanakkor BC-2026-0001.
2. 2027. január 1-jei NIR: NIR-2027-0001.
3. Elbukó köteg (pl. ütközés): a számláló nem nő, a következő sikeres bizonylat kapja a számot.
