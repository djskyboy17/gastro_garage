# Számlázás az Oblióval (v77, 5. fázis, 1. lépés)

A számlát az **Oblio** (oblio.eu) állítja ki, sorszámozza és küldi be az SPV-be; a Gastro Garage előkészíti, jóváhagyatja, elküldi az API-n, és tárolja az eredményt. A konyha, a raktár, a NIR, a bon de consum és a pénztár marad a Gastro Garage-ban (az Oblio készletét nem használjuk, `useStock: 0`).

Egyeztetés (2026-11-04):
- vannak **magánszemélyek** (bon fiscal), **cégek, akik minden rendelésnél számlát kérnek**, és **cégek, akik többször rendelnek, és a hónap végén egy számlát kérnek**;
- fizetnek **helyben**, **a futárnak**, és (havi számlánál) **utólag**, jellemzően utalással.
- Pénztárgép: Tremol S25 (a Z-jelentés beolvasása külön munkában készül, a `finance` modulban).

## 1. Ügyfél számlázási adatai
- Ügyfelenként (új tábla, a `customers` mellé): **típus** (magánszemély / cég), **számlázási mód**:
  - **bon fiscal** (alap, magánszemély) – nincs számla, mint most;
  - **számla minden rendelésnél**;
  - **havi gyűjtőszámla** – fizetési határidő napokban (pl. 15).
- Cégnél: cégnév, **CUI/CIF** (ellenőrző számjeggyel, mint a beszállítói számlánál), Reg. Com., székhely (cím, megye, ország), e-mail (opcionális).
- Az ügyfelek lapon szerkeszthető (iroda).

## 2. Számla egy rendelésből („minden rendelésnél”)
- A rendelés részleteinél: **Számla előnézet** → tételek, szállítási díj, TVA-kulcsonként bontva, végösszeg → **Jóváhagyás és kiállítás**.
- Feltétel: visszaigazolt rendelés, nincs még érvényes számlája, a vevő számlázási adatai teljesek.

## 3. Havi gyűjtőszámla
- Új **Számlák** fül (iroda): hónapválasztó; a havi számlás ügyfelek listája a hónap **kiszállított / átadott, még nem számlázott** rendeléseivel.
- Ügyfelenként **előnézet** (a rendelések tételei összesítve étel és ár szerint, a szállítási díjak, a rendelések és az **avizok számai** a megjegyzésben) → **Jóváhagyás és kiállítás**.
- Havi számlás ügyfél kiszállításos rendeléséhez **automatikusan aviz kell** (a v75-ös aviz-szabály bővül).
- A **futár** ilyen rendelésnél nem szed pénzt: a futárappban „Havi számla – nem kell fizetni”.
- [ELLENŐRIZENDŐ] a könyvelővel: a havi számla legkésőbbi kiállítási napja (tudomásunk szerint a következő hónap 15-e).

## 4. Kiállítás és dupla számla elleni védelem
- A jóváhagyás egy tranzakcióban menti a **számlakérést** (pillanatkép: vevő, sorok, TVA, végösszeg, a rendelések listája) **egyedi kulccsal**, és a rendeléseket „számlázás alatt” jelöli. Egy rendelés legfeljebb egy érvényes számlán lehet.
- Ezután hívjuk az Obliót (`POST /api/docs/invoice`, `useStock: 0`, `idempotencyKey` = a kérés kulcsa, `orderNumber` = rendelés- / hónapazonosító). Két kattintás vagy megszakadt kapcsolat utáni újrapróbálás ugyanazt a kulcsot küldi → az Oblio nem állít ki második számlát.
- Siker: eltároljuk az Oblio sorozatát, számát és a dokumentum linkjét; a rendelések és az avizok „számlázva”.
- Hiba / nincs válasz: a kérés „küldésre vár” marad, **Újrapróbálás** gombbal (ugyanazzal a kulccsal). A konyhai és futármunka ettől nem áll meg.
- Az Oblio-hívás soha nem adatbázis-tranzakción belül történik.

## 5. SPV
- Kiállítás után beküldés (`POST /api/docs/einvoice`), vagy az Oblio automatikus beküldése, ha ott be van kapcsolva.
- Állapot: **beküldve – feldolgozás alatt / elfogadva / hibás**, frissítés gombbal (`GET /api/docs/invoice/list` `withEinvoiceStatus`); a számla PDF-je és az SPV-archívum letölthető (csak iroda).

## 6. Fizetés és vevői egyenleg
- A rendelésen már rögzített befizetések (helyben, futár) a számlán **fizetettként** mennek át az Obliónak (`collect`: készpénz / kártya; [ELLENŐRIZENDŐ] cég készpénzes fizetésénél nyugta vagy bon fiscal).
- Havi számlánál az utólagos fizetés (**utalás**) a Számlák fülön rögzíthető, részletben is → átmegy az Obliónak (`PUT /api/docs/invoice/collect`, „Ordin de plata”).
- **Nyitott vevői tartozások**: ügyfelenként, lejárt számlák kiemelve (mint a beszállítói oldalon).
- Ha az Oblio épp nem érhető el, a fizetés nálunk rögzül, az átadás később újrapróbálható.

## 7. Sztornó
- Admin, indokkal: sztornószámla az Oblióban (`referenceDocument` + `refund`), a rendelések újra számlázhatók lesznek. Számla nem törölhető.

## 8. TVA
- Az árak bruttók (`vatIncluded: 1`, mint most a katalógusban). TVA-kulcs **beállítható**: ételekre és a szállítási díjra külön (alapértékek a könyvelővel egyeztetve). [ELLENŐRIZENDŐ]
- A számla kulcsonkénti összegeit a mi oldalunk is kiszámolja az előnézethez; ha az Oblio végösszege eltér, figyelmeztetünk.

## 9. Oblio-kapcsolat
- **Szimulált mód** (alapértelmezés, amíg nincs kulcs): ugyanazokat a válaszokat adja, mint az Oblio (sorszám, link, SPV-állapot), a dupla kulcsot is kezeli – így minden kipróbálható élesítés előtt.
- **Valódi mód**: ha a szerver titoktárában megvan az `OBLIO_CLIENT_ID`, `OBLIO_CLIENT_SECRET`, és a beállításokban a cég CIF-je és a számlasorozat. Token kezelése (1 óra), lekérdezésekkel ellenőrizhető kapcsolat (cégek, sorozatok, TVA-kulcsok). A titok soha nem kerül a tárolóba, a chatbe vagy a naplóba.

## Jogosultság
- Számla előnézet, kiállítás, újrapróbálás, fizetés rögzítése: iroda (tulajdonos, admin, diszpécser).
- Sztornó, Oblio-beállítás, TVA-beállítás: admin.

## Ami NEM része ennek a lépésnek
- Bejövő e-Factura XML feltöltése a beszállítói számlákhoz (külön lépés).
- Bon fiscal kiállítása az Oblión keresztül (az Oblio API-ja nem tudja; a pénztárgép a helyén marad).
- Magánszemélynek kiállított számla (ha kell, a „számla minden rendelésnél” mód magánszemélyre is bekapcsolható, CNP nélkül) – [ELLENŐRIZENDŐ].

## Megvalósítás
- Táblák (migráció 0033): `customer_billing`, `billing_settings`, `sales_invoices` (egyedi `idempotency_key`), `sales_invoice_orders` (részleges egyedi index: rendelésenként egy érvényes számla), `sales_invoice_payments`, `sales_invoice_collects` (befizetés-átadás forrásonként egyszer), `oblio_simulated`.
- Végpontok: `GET /api/billing?period=`, `/preview`, `/order?id=`, `/simulated-doc`; `POST /approve`, `/send`, `/spv`, `/collect-sync`, `/payment`, `/profile` (iroda); `/storno`, `/settings`, `/check` (admin).
- Felület: **Számlázás és e-Factura** fül (havi gyűjtőszámlák, számlák, nyitott tartozások, ügyfelek számlázási adatai, Oblio-beállítás); a rendelés részleteinél **Számla** panel.
- A kliens kattintásonként egy kulcsot (`clientKey`) küld; ugyanaz a kulcs → ugyanaz a számla. Más kulccsal ugyanarra a rendelésre: `BILLING_ALREADY_INVOICED` / nincs számlázandó.
- Bizonytalan Oblio-válasz → `pending` (újrapróbálás ugyanazzal a kulccsal); elutasítás / hiányzó beállítás → `failed` az üzenettel.
- Szimulált mód tesztjelei: a vevő nevében „OBLIOHIBA” → elveszett válasz; „SPVHIBA” → SPV-elutasítás. A szimulált SPV a második lekérdezésre elfogad.
- Valódi módhoz: titoktár `OBLIO_CLIENT_ID` (az Oblio belépési e-mail) és `OBLIO_CLIENT_SECRET` (Setări → Date Cont), a beállításokban a cég CIF-je és a sorozat.

## Ismert korlátok
- Ha egy már az Obliónak átadott befizetést utólag sztornóznak, az Oblióban kézzel kell törölni (az API-ban nincs erre végpont).
- Sztornózott számlára korábban érkezett befizetés nem száll át automatikusan az új számlára; a pénz visszaadása vagy átvezetése kézi teendő.

## Ellenőrző példák (tests/billing.test.mts; helyben, szimulált Oblióval mind kipróbálva)
1. Céges ügyfél, „számla minden rendelésnél”: előnézet → kiállítás → Oblio-sorszám és link látszik; két egyidejű kattintásból egy számla lesz.
2. Megszakadt kapcsolat a kiállításnál: a kérés „küldésre vár”; újrapróbálás ugyanazzal a kulccsal → egy számla.
3. Havi számlás cég, 3 kiszállítás a hónapban (3 aviz, a futár nem szedett pénzt): hónap végén egy számla a 3 rendeléssel és az avizszámokkal; ugyanezek a rendelések nem kerülhetnek másik számlára.
4. Egy rendelést a vevő helyben kifizetett: a számlán fizetettként jelenik meg; a havi számla maradéka utalással fizethető, a nyitott tartozás nullára megy.
5. Sztornó után a rendelések újra számlázhatók, a régi számla „sztornózva”.
6. SPV-elutasítás: a számla „hibás” állapotú, látszik az üzenet.
7. Hiányos céges adat (nincs CUI): nem állítható ki, érthető hibaüzenettel.

## Rendelésfelvétel számlázási módja – 2026-11-05

GET /api/billing/customer-mode?customerId=…: a meglévő irodai szerepkörökkel elérhető, csak a mode mezőt visszaadó olvasás. A hiányzó ügyfélprofil receipt módot jelent. Nem tölti be a számlaegyenlegeket és számlalistákat. Az új rendelés per_order/monthly módnál kihagyja a készpénz/kártya választását és üres tervezett módot küld; sem számlát, sem befizetést nem hoz létre ettől.

## Havi beszedés helye – 2026-11-05

A havi gyűjtőszámlás ügyfél fizetése a kiállított számlához tartozik, nem a rendeléshez. A billing/order-collection.ts feltétele az aktuális ügyfélprofil alapján tiltja a rendelésenkénti pénzbeszedést és az új fiskális nyugta-előkészítést. A finance és fiscal modul az ellenőrzést az atomikus írási kötegben is használja. A meglévő POST /api/billing/payment csak issued, nem sztornó számlán enged befizetést; ez a működés megmarad. Egy havi számla kifizetése nem hoz létre külön payments sort a rendeléseken, így nem duplázzuk az összeget.
