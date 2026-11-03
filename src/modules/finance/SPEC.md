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
- Eszközintegráció (a pénztárgép közvetlen olvasása) nincs, csak a típus ismeretében később.

## 5. Beszállítói kifizetések
- A bevételezett beszállítói számláknál rögzíthető a kifizetés: dátum, összeg, mód (**pénztárból** / **bankból**), részfizetés is.
- Pénztárból fizetett összeg automatikusan kiadásként a pénztárba kerül (egy tranzakcióban).
- Lista: **nyitott tartozás** szállítónként, **lejárt** számlák (a fizetési határidő szerint) kiemelve.

## Jogosultság
- Futár: csak a saját rendeléseinek fizetése és a saját „nálad lévő” összege.
- Iroda (admin, diszpécser): fizetés a rendelésen, futár-leadás átvétele, pénztártételek, Z-jelentés, nap lezárása.
- Beszállítói kifizetés és a pénztárnap visszanyitása: admin.

## Ami NEM része
- Banki utalás vevőtől, bankszámla-kivonat egyeztetése; nyitott vevőegyenleg számlával – az 5. fázissal (számlázás) jön.
- Pénztárgép-integráció, online fizetés.

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
