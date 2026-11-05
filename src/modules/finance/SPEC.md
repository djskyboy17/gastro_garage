# Pénzügy és pénztár (v76, 6. fázis)

Egyeztetés (2026-11-04):
- az ügyfelek fizetnek **készpénzzel a futárnak**, **készpénzzel átvételkor** és **kártyával (POS)**; banki utalás nincs;
- **van pénztárgép, minden eladásról bon fiscal készül**, naponta Z-jelentés;
- a futár **a futárappban rögzíti** a beszedett összeget, és **este leadja** az irodának;
- a **beszállítók kifizetését is** itt követjük.

## Adatok és végpontok
- Táblák: `payments` (előjeles, sztornó = ellentétes tétel), `courier_handovers`, `cash_entries` (előjeles), `cash_days`, `z_reports`, `supplier_payments`. Migráció 0032.
- `GET /api/finance/order?id=`, `GET /api/finance/day?date=`, `GET /api/finance/register?date=` (nyomtatás); `POST /api/finance/payment`, `/payment/reverse`, `/handover`, `/cash`, `/cash/reverse`, `/day/close`, `/z`: iroda. `/day/reopen`, `/supplier-payment`, `/supplier-payment/reverse`: admin.
- A futár a `POST /api/courier/state` kérésben, kézbesítéskor küldi a fizetést (`payment: {method, amount}`), egy kötegben a kézbesítéssel; az ismételt kérésből nem lesz második befizetés.
- A régi „fizetve” kapcsoló (`/api/orders/state`, `payment`) megszűnt (`USE_PAYMENTS`); a rendelés `payment` mezőjét a befizetések frissítik. A v76 előtt „fizetve” jelölt, befizetés nélküli rendelés fizetettnek számít.
- Pénztártétel mindig a mai (Europe/Bucharest) napra kerül. [FELTÉTELEZÉS] Visszamenőleges pénztártétel nincs.

## 1. Fizetés a rendelésen
- Egy rendeléshez több fizetés is rögzíthető (részfizetés): mód (**készpénz** / **kártya**), összeg baniban, ki vette át (futár / iroda), mikor. A „fizetve” állapot ebből számolódik: ha a befizetések elérik a rendelés végösszegét (szállítási díjjal együtt).
- **Futárapp:** kézbesítéskor egy lépésben: „Kézbesítve – fizetett: készpénz / kártya / már fizetett”. Az összeg alapból a végösszeg, átírható (pl. kevesebbet adott). A futár csak a saját aznapi rendeléseinél rögzíthet, mint eddig.
- **Iroda / helyszíni átvétel:** a rendelés részleteinél ugyanez; a mostani „Fizetve” gomb helyett.
- Tévesen rögzített fizetés: törlés helyett **sztornó** (ellentétes tétel, indokkal), a napló megmarad.

## 2. Futár készpénzének leadása
- A futár appjában látszik: **„Nálad lévő készpénz”** = a még le nem adott készpénzes befizetései.
- Este az iroda **átveszi**: beírja a ténylegesen átadott összeget; a rendszer mutatja az elvárt összeget és az **eltérést** (eltérésnél indoklás kell). Az átadott összeg bevételként a pénztárba kerül.
- Egy leadás után az addigi befizetések lezártak (nem módosíthatók).

## 3. Pénztár (registru de casă)
- Egy pénztár [FELTÉTELEZÉS]. Naponta: **nyitó egyenleg** (az előző nap záró egyenlege), bevételek, kiadások, **záró egyenleg**.
- **Bevétel:** helyszíni készpénzes eladás (az iroda rögzítette fizetésekből, napi összesítve), futár-leadás, egyéb bevétel (pl. pénz betétele a pénztárba).
- **Kiadás:** beszállítói számla készpénzes kifizetése (automatikusan, a számlához kötve), bankba befizetés, egyéb kiadás (indokkal, bizonylatszámmal).
- A tételek véglegesek; javítás sztornó-tétellel. A záró egyenleg nem lehet negatív.
- Napi nyomtatható **REGISTRU DE CASĂ** oldal (román), sorszámozott tételekkel.
- A napot az iroda **lezárja**; utána csak az admin nyithatja vissza.
- [ELLENŐRIZENDŐ] Chitanță: mivel minden eladásról bon fiscal készül, a vevői befizetéshez nem kell. Egyéb (nem eladásból származó) bevételhez később hozzáadható.

## 4. Z-jelentés egyeztetése
- Naponta kézi rögzítés: Z-szám, bruttó összesen, ebből készpénz és kártya (és ha kell, TVA-kulcsonként).
- A rendszer összeveti a nap rögzített fizetéseivel (készpénz és kártya külön): **eltérés** jól látható, indoklással zárható.
- A Tremol S25 lezárt napjának ANAF A4203 fájlja (XML vagy beágyazott XML-t tartalmazó DER P7B) a böngészőben tölti ki a Z-űrlapot. A nyers fájl és a nyugtatételek helyben maradnak. A fájl beolvasása nem ellenőrzi a P7B aláírását, és nincs közvetlen eszközkapcsolat.
- Az űrlapra csak a kiválasztott naphoz tartozó, RON-ban és készpénzre/kártyára bontható Z-adatok kerülnek. A naponként egy Z-t kezelő űrlap másik már mentett Z-szám esetén elutasítja az importot. Mentéshez az operátor jóváhagyása szükséges.
- Példa: a 0042-es jelentés 28,25 lej készpénze és 12,10 lej kártyás bevétele 40,35 lej összesent tölt ki. A jelentés csak a mentés után jelenik meg az egyeztető táblázatban és újratöltéskor.

## 5. Beszállítói kifizetések
- A bevételezett beszállítói számláknál rögzíthető a kifizetés: dátum, összeg, mód (**pénztárból** / **bankból**), részfizetés is.
- Pénztárból fizetett összeg automatikusan kiadásként a pénztárba kerül (egy tranzakcióban).
- Lista: **nyitott tartozás** szállítónként, **lejárt** számlák (a fizetési határidő szerint) kiemelve.

## Tremol S25 nyugtafájl

Az állapottartó konyhai nyugtafolyamat a fiscal modulban található. A korábbi közvetlen, kifizetett-rendeléses exportot ez váltja fel; lásd az alábbi frissítést és a fiscal/SPEC.md fájlt.

## Jogosultság
- Futár: csak a saját rendeléseinek fizetése és a saját „nálad lévő” összege.
- Iroda (admin, diszpécser): fizetés a rendelésen, futár-leadás átvétele, pénztártételek, Z-jelentés, nap lezárása.
- Beszállítói kifizetés és a pénztárnap visszanyitása: admin.

## Ami NEM része
- Banki utalás vevőtől, bankszámla-kivonat egyeztetése; nyitott vevőegyenleg számlával – az 5. fázissal (számlázás) jön.
- Több kassza, futárkassza, online fizetés és POS-tranzakció indítása.

## Lemondás befizetéssel
- Befizetett (nettó nem nulla) rendelés nem mondható le (`ORDER_HAS_PAYMENTS`): előbb a befizetést kell sztornózni (visszaadni).
- Ha volt befizetése (sztornózva), lemondáskor nem törlődik véglegesen, hanem „lemondott” lesz; a végleges törlés soha nem fut befizetéssel rendelkező rendelésen.

## Ellenőrző példák (tests/finance.test.mts; a futár, az iroda, a pénztár, a Z és a beszállítói kifizetés helyben, a futó alkalmazásban kipróbálva)
1. 85 lejes rendelés, a futár 85 lejt rögzít készpénzzel → „fizetve”; 50 lejnél „részben fizetve”, 35 lej hiányzik.
2. A futárnál 3 rendelés után 210 lej van; este 200 lejt ad le → 10 lej eltérés, indoklás nélkül nem zárható; a pénztárba 200 lej bevétel kerül.
3. A pénztár: nyitó 500, futár-leadás +200, helyszíni készpénz +85, beszállítói kifizetés −120 → záró 665; a következő nap nyitója 665.
4. Z-jelentés: készpénz 285, kártya 140; a rögzített fizetések: készpénz 285, kártya 130 → 10 lej kártya-eltérés látszik.
5. 1000 lejes beszállítói számla, 400 pénztárból, 600 bankból → kifizetve; a pénztárban −400 kiadás; lejárt számla nincs a listán.
6. Tévesen rögzített fizetés sztornója: az állapot visszaáll „nem fizetett”-re, a sztornó a naplóban és (ha leadott készpénz volt) a pénztárban is látszik.

## Konyhai nyugtafolyamat – 2026-11-05

A korábbi, már kifizetett rendelésből közvetlenül letölthető GET `/api/finance/tremol-job` export helyett a `fiscal` modul állapottartó folyamata használatos; a régi végpont 410-et ad. A rendelésben mentett tervezett készpénz/kártya és a nyugta állapota külön adat a tényleges befizetéstől. A nyugtázás semmilyen befizetést vagy pénztártételt nem hoz létre.

A Pénztár külön panelje a visszaigazolt élő nyugtákat veti össze a mentett Z-vel. A meglévő beszedési egyeztetés megmarad; előnyomtatás esetén különbözhet a nyugtázás és a beszedés napja. A rendelés fizetési paneljének alapértelmezett módja a mentett terv, a kezelő a tényleges módot rögzíti. Részletek: `src/modules/fiscal/SPEC.md`.

## Havi gyűjtőszámla: nincs rendelésenkénti beszedés – 2026-11-05

A havi (`monthly`) ügyfél rendelésének GET /api/finance/order válasza collectionDeferred=true. A részletekben nincs fizetési státusz mező vagy új befizetési űrlap; befizetés nélküli rendelésnél a teljes fizetési panel rejtett. Ha korábban volt befizetés, az előzmény és sztornó nem vész el, de új beszedés nem indítható. A meglévő lekérdezés eredménye vezérli a státuszmezőt is, további API-hívás nélkül.

POST /api/finance/payment havi ügyfélnél PAYMENT_MONTHLY_INVOICE (409). A recordPaymentStatements közös, iroda és futár által használt atomikus őre ugyanezt az aktuális customer_billing profilból ellenőrzi, így a közben megváltoztatott profil is tilt. A futár állapotvégpont érthető hibát ad, ha havi rendelést befizetéssel próbálnának kézbesíteni; beszedés nélküli kézbesítés megmarad. A normál és per_order profilok változatlanul fizethetők rendelésenként.

A havi számla kiállítása utáni befizetést a billing modul számlafizetési végpontján rögzítjük. A rendelés payment mezőjét ettől nem hamisítjuk fizetettre; a számlaegyenleg az irányadó. Példa: havi rendelés kézbesítve, payments sor nélkül; kiállított havi számla kifizetése → sales_invoice_payments, továbbra sincs rendelésenkénti pénzbeszedés.
