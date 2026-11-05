# Courier mobile workspace — v12

> **Érvényes állapot (v71).** Ez az összefoglaló a mérvadó; az alábbi, korábbi változatokból maradt szöveg ahol ellentmond neki, elavult.
> - Egy futár van: futártörzs, fiók-összekötés, napi beosztás és futárválasztás nincs (v51).
> - Minden „futár” szerepkörű fiók ugyanazt az aznapi kiszállítási listát látja a futárportálon (courier.veres.no); más dolgozó és ügyfél nem.
> - Indulás csak elkészült étellel; induláskor a futár neve a rendelésre kerül (pillanatkép). Kézbesítés / sikertelen kézbesítés rögzíthető, változat-ellenőrzéssel és naplóval.
> - A futár csak a kiszállításhoz szükséges adatokat látja (név, cím, telefon, tételek, megjegyzés).

Route /courier is public as a sign-in/access shell. Private tasks require the courier member role AND a unique admin-assigned courier-account binding. The role is deliberately not part of isMember: it cannot access /api/data or any generic staff business endpoints. A courier opening / is sent to /courier before data fetch. The portal/customer identity remains independent; courier status does not grant sales, inventory or financial authority.

Setup: visitor signs in and requests employee access; admin/owner grants courier role in employee access; admin/owner connects that account to an existing courier master record. Matching is by stable user ID, never by name/email supplied by the courier. One account can be bound to only one courier record. Only admin/owner may link/unlink, using binding revision checks and an atomic audit. Role changes away from courier clear the binding and increase its revision through a DB trigger. No production courier account or binding is seeded.

GET /api/courier/tasks uses server identity and current binding. It queries confirmed non-pickup orders assigned to that courier, filtered to the selected date; unfinished overdue work and in-transit work remain visible across date selection. Selectable dates are today ±30 kitchen-local days. DTO exposes only route-needed customer name, saved address/phone, delivery window, order note, product names/quantities/allergens, production/delivery status, revision and delivery-outcome history. No prices, payment state, customer/master/recipe/user IDs, private fulfillment JSON, global audit or other-courier tasks. History is limited to transit/delivered/failed outcome notes on currently assigned tasks; assignment notes are not exposed.

POST /api/courier/state accepts request UUID, order ID, order revision, transit/delivered/failed and a note. Shared nextState rules enforce ready-before-departure, confirmed orders, assignment and transit-before-outcome; failures require a nonempty reason. No pickup handover or payment modification from this route. The transaction rechecks member role, binding ID/revision, order ownership/revision, confirmation and non-pickup status. Order state, outcome event and audit commit atomically. Event UUID makes identical retries idempotent; a changed payload conflicts. Reassignment/rebinding/disable races cannot alter another courier's order. Pending or failed orders may be reassigned by dispatcher as before; an old courier then loses access.

The responsive HU/RO page has date selection, current/finished tasks, overdue badges, manual refresh and visible errors. No silent optimistic state changes. Address navigation opens an external Google Maps URL only on the courier's click (with the saved destination address); phone link strips formatting and accepts only phone characters. No GPS permission or tracking. Private task data stays in component memory, never localStorage/cache/offline storage; only language preference is stored. Revocation/authorization errors clear private state. No service worker, background location, signatures/photos, cash collection or notification integration in this slice.

Acceptance: courier A cannot read/change B's tasks, spoof courier/user query parameters, reach /api/data or use staff writes; unbound/disabled users see no tasks; stale revisions and reassignment races reject mutations; identical concurrent retries produce one event; failure note mandatory; queued food cannot depart; ready→transit→delivered survives reload; role revocation unlinks account and blocks old requests; HU/RO mobile UI and original dispatcher workflows remain functional.

V14: task DTO also exposes packingReady, with no checklist details. Departure now requires the kitchen/dispatcher packing confirmation through the shared guard; already in-transit historical orders can still be completed. Couriers cannot check or reopen packing.

## Egy futár, összekötés nélkül — v51
A futártörzs (`couriers`) és a fiók–futár összekötés megszűnt (a `courier_unlink_role` triggerrel együtt). Egyetlen futár van: aki **futár** szerepkört kap a Hozzáférés oldalon, az a `/courier` oldalon látja az összes kiszállításos feladatot (visszaigazolt, nem átvételes rendelés a kiválasztott napon, valamint az úton lévők és a korábbi napokról maradt, még nem kézbesítettek). Külön hozzárendelés nincs.
- Induláskor a rendelésre a futár saját neve kerül (`orders.courier_name`, egyszerű szöveg). A kézbesítés és a sikertelen kézbesítés nem írja át.
- A tranzakció továbbra is ellenőrzi a változatot (revision), a visszaigazolt, nem átvételes rendelést és azt, hogy a felhasználó még futár szerepkörű.
- Megszűnt végpontok: `GET /api/courier/accounts`, `POST /api/courier/bind`; a felület (Hozzáférés → futárfiókok összekötése) is.
- Ha több futár szerepkörű fiók lenne, mindegyik ugyanazt a teljes listát látná.

## Fizetés kézbesítéskor — v76
- A feladat a rendelés **hátralékát** mutatja (`due`, bani); tételárak, fizetési előzmény továbbra sem látszanak. A napi összesítőben a futárnál lévő, még le nem adott készpénz (`cashOnHand`).
- Kézbesítéskor a futár kiválasztja: készpénz / kártya / már fizetett, az összeg alapból a hátralék, átírható (túlfizetés nem rögzíthető). A befizetés a kézbesítéssel egy kötegben rögzül; ismételt kérés nem rögzíti újra.
- A készpénzt este az iroda veszi át a Pénztár fülön (../finance/SPEC.md).

## Havi számlás ügyfél — v77
- Havi gyűjtőszámlás ügyfél rendelésénél a feladaton „Havi számla – nem kell fizetni” áll, a hátralék 0 (a futár nem szed pénzt).

## Aviz megnyitása

- A rendeléskártyán Aviz gomb nyitja meg a már kiállított dokumentum román nyomtatási nézetét. Kiállításra váró aviznál a gomb inaktív és érthető állapotjelzés látszik.
- A GET `/api/courier/aviz?orderId=&date=` ellenőrzi az aktuális Futár szerepkört, a dátumtartományt és a feladat aktuális láthatóságát. Az egyfutáros modellben ez ugyanaz a közös feladatlista, amelyet a futárfelület használ.
- Átvételes, lemondott vagy a választott feladatlistán kívüli rendelés avizja nem szolgálható ki. Sztornózott dokumentum helyett csak aktuálisan érvényes aviz nyitható meg. A megnyitás nem állít ki új bizonylatot.
- Alkalmazott könyvelési profillal az aviz nélküli indulás adatbázisszinten tiltott, az állapot, befizetés és napló együttes visszagörgetésével.
