# Fogyasztói címke QR-kóddal (labels) — v32

## Cél
A kiszállított, becsomagolt adag előrecsomagolt élelmiszer, ezért az EU 1169/2011 szerinti címke kell rá, románul. A címke adagonként egy példányban nyomtatható 62 mm széles címkeszalagra. A QR-kód egy nyilvános oldalt nyit meg ugyanezekkel az adatokkal magyarul és románul.

## Adatok
- `label_settings` (egyetlen sor, `revision` + JSON): gyártó neve, címe, egy szabad sor (pl. ANSVSA-nyilvántartási szám), alapértelmezett tárolási feltétel románul és magyarul.
- `product_labels` ételenként: fogyaszthatósági idő napokban (0–60, a gyártás napjától; 0 = aznap), tárolási feltétel románul/magyarul (üresen az alapértelmezett érvényes). Ha egy ételnek nincs sora, a fogyaszthatósági idő „nincs megadva”.

## A címke tartalma
- Étel neve (románul, alatta magyarul), összetevők tömeg szerint csökkenő sorrendben; az allergént tartalmazó alapanyag **félkövér**; al-recept zárójelben; fagyasztott alapanyag `*` jellel és „* din materie primă congelată” megjegyzéssel (Legea 321/2023).
- Allergének: a rendeléskor mentett allergének és a recept allergénjei együtt.
- Átlagos tápérték 100 g-ban: energia (kJ/kcal), zsír, telített zsírsavak, szénhidrát, cukrok, fehérje, só (számolt érték, lásd `../inventory/SPEC.md`).
- Nettó tömeg (az étel adagtömege), gyártás napja (= a rendelés napja), „A se consuma până la” (gyártás napja + fogyaszthatósági idő), tételszám, tárolás, gyártó.
- QR-kód: `https://<portál címe>/label?id=<rendelési tétel azonosítója>`; mellette a rendelés kódja a csomagolóknak.
- Recept: a rendeléskor mentett receptváltozat; ha nincs, a legfrissebb.

[FELTÉTELEZÉS] Tételszám = gyártási nap + étel (`L` + ééhhnn + 4 jeles ételkód): egy étel egy napi főzése egy tétel. Ha a konyha egy napon több adagban főz, ez nem különbözteti meg őket.
[FELTÉTELEZÉS] A nettó tömeg az étel jelenlegi adagtömege (az adagtömegről nincs pillanatkép a rendelési tételben).

## Hiányzó adat
Semmit nem töltünk ki csendben. A címkenézet ételenként felsorolja, mi hiányzik (recept, tápérték, fogyaszthatósági idő, tárolás, gyártó); a címkén „nedeclarat” áll. Allergén nélküli címke csak akkor mondja, hogy nincs allergén, ha van recept.

## Végpontok és jogosultság
- `GET /api/labels?date=&orderId=` — tulajdonos, admin, konyha, diszpécser. A visszaigazolt, még csomagolandó rendelések tételei (ugyanaz, mint a csomagolási nézet), ±90 nap.
- `GET /api/labels/settings`, `POST /api/labels/settings` — csak tulajdonos és admin. A mentés `revision` alapján ütközést jelez (`CONFLICT`); a beállítás, az ételek sorai és a napló egy kötegben mentődnek.
- `GET /api/public/label?id=` — bejelentkezés nélkül. Csak visszaigazolt rendelés tétele; ügyfélnév, cím, ár, rendeléskód nélkül. Ismeretlen kód: 404.
- Felület: Beállítások → Címkeadatok; Napi munkaterv és csomagolás → Termékcímkék (nyomtatás: csak a címkék, 62 × 100 mm-es oldalanként); nyilvános oldal: `/label?id=`.

## Nincs még benne
- Jóváhagyott (nem számolt) tápérték, adalékanyagok, „poate conține” keresztszennyeződés-jelölés.
- Gyártási tételek valódi nyilvántartása (a tételszám számolt).
- A QR-kód nem helyettesíti a nyomtatott kötelező adatokat.

## Ellenőrző példák
1. 2 napos fogyaszthatósági idő, gyártás 2026-11-03 → „A se consuma până la 05.11.2026”; 3 adag → 3 címke.
2. Allergént tartalmazó alapanyag félkövér; al-recept zárójelben; fagyasztott `*`.
3. Recept, fogyaszthatósági idő, tárolás vagy gyártó nélkül → hiánylista, nem üres helyettesítés.
4. A nyilvános válaszban nincs rendeléskód, példányszám, ügyfélnév.
5. Elavult `revision` mentés → 409, semmi nem változik. Konyha/diszpécser nem menthet címkeadatot.

## Kijelölés nyomtatás előtt — v33
Nem minden ételre kerül címke. A Termékcímkék nézetben ételenként (rendelési tételenként) be kell jelölni, hogy kell-e címke; alapból egyik sincs kijelölve. Kijelöléskor a példányszám az adagszám, 1–100 között átírható. Csak a kijelölt címkék nyomtatódnak, a megadott példányszámban; a hiányzó adatokra figyelmeztetés is csak a kijelöltekre szól. A kijelölés nem mentődik (újratöltés vagy napváltás után üres), és semmilyen adatot nem módosít.

## Hiányzó adat pótlása felugró ablakban — v34
A Termékcímkék hiánylistájában az étel sorára kattintva felugró ablak nyílik. Tulajdonos és admin itt pótolhatja az étel fogyaszthatósági idejét és tárolását, valamint a gyártói adatokat (ez minden címkére érvényes). Mentéskor csak az adott étel sora és a beállítások mentődnek (ugyanaz a `POST /api/labels/settings`, ütközésvizsgálattal); utána a címkék újratöltődnek, a kijelölés megmarad. Recept és tápérték itt nem pótolható: az ablak megmondja, melyik oldalon lehet. Konyha és diszpécser a hiánylistát látja, de nem kattintható, és jelzi, hogy tulajdonos/admin pótolhatja.
