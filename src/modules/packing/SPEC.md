# Daily production plan and packing — v14

Boundaries: read-only daily portion aggregation, a per-order item checklist and printable internal working labels. Catalog, orders, production, delivery and payments remain separate. No stock changes, readiness changes, assignment, pricing, notifications or customer edits from this module. Printed labels do not assert food safety, shelf life or storage instructions.

Approved owner/admin, kitchen and dispatcher roles can read/check. Couriers, warehouse, public visitors and pending/disabled accounts cannot. Dedicated date-scoped projection includes saved customer name for identifying packages but excludes addresses, phone, prices, payment, member identifiers and recipes. Names must not be logged or placed in local storage. Default day and date bounds use Europe/Bucharest, ±90 days.

Only confirmed orders enter the plan, including completed orders for reconciliation. Aggregate by saved time/window, HU/RO name and allergen declaration; changed snapshots remain separate. Planned, kitchen-ready and packing-checked portions are separate counts. Delivery and pickup are identified per order. An active order is dispatchable only with ready food, all items checked and courier assignment; pickup requires ready food and all items checked.

Checklist belongs to saved order-item IDs. A checkbox confirms the full integer portion quantity on its row. Empty/partial selection stays unchecked overall. Unknown and duplicate IDs reject; empty-item orders cannot become complete. Only confirmed, ready, pending/failed delivery orders may be checked or reopened. Shared domain owns this rule and the dispatch/pickup guard. No manual override. Order revision is the concurrency token; selection, derived ready flag, checked timestamp and audit save atomically. Reopening clears completion. Assignment or any order revision change makes a stale checklist reject. Dispatched/completed checklists lock.

New fields default to unchecked. Existing pending/failed orders need checking before departure or pickup; historical in-transit/delivered orders are not backfilled or falsely marked checked, and can still finish delivery. Existing snapshots remain untouched. The generated additive Drizzle migration must run before code deployment; no request-time DDL.

Working labels: one per saved order item, entire quantity, order code, customer name, kitchen-local date/window, pickup/delivery mode and saved allergens. No current catalog lookup. Labels show unchecked state if applicable. Empty allergen declarations are described as missing data, never allergen-free. An order selector restricts checklist/labels to one order; the portion plan always covers the whole date. Order details can open the corresponding date/checklist directly. Print only the selected plan/labels/checklist view, preserve text, hide application chrome and controls. No claim of regulatory packaging-label compliance.

Acceptance:
1. Two confirmed orders with the same saved food/allergens/window aggregate; requested/cancelled/rejected orders do not appear. Different allergen/name/window snapshots do not merge.
2. Ready order: check some rows, save/reload, remain incomplete. Check all, save/reload, become complete with timestamp. Printing alone makes no change.
3. Unknown/duplicate row, unready order, foreign role, wrong origin or stale revision rejects without audit or checklist mutation. Concurrent saves at one revision allow only one write.
4. Every generic/courier departure and pickup handover rejects unchecked packing. Courier sees packing readiness only and cannot check it. Ready+checked+assigned departure works; in-transit completion remains possible for historical unchecked orders.
5. Uncheck before departure blocks it again. After departure checking is locked. No stock/payment mutation. HU/RO screen and print use immutable snapshots.

## Felvett rendelések kimaradnak — v21
A csomagolási nézet (terv, rendelések, címkék) csak azokat a rendeléseket mutatja, amelyeket még csomagolni kell: a kiszállítás állapota „függőben” vagy „sikertelen” (újra kell küldeni). Ami már úton van, kézbesítve lett vagy amit az ügyfél átvett, kimarad (`needsPacking`).

A fogyasztói címke (fogyaszthatósági idő, tárolás, QR-kód) külön modul: ../labels/SPEC.md (v32). Az itteni munkacímke továbbra is belső címke.

## Csomagolás külön modulként — v36
- A modul neve „Csomagolás”; két nézete van: Csomagellenőrzés és Termékcímkék. Az adagterv (Adagterv fül) és a belső munkacímke (Címkék fül) megszűnt. Az adagterv tartalma az Áttekintés „Mi készül ma?” paneljébe került: ételenként összes, elkészült és ellenőrzötten csomagolt adag, valamint az allergének.
- Futár a csomagellenőrzésből: kiszállításos, még nem indult rendelésnél a kártya alján látszik a futár. Ha nincs, a napra beosztott futárok közül lehet választani (javasolt: akinek aznap a legkevesebb nyitott kiszállítása van); a kiosztás ugyanaz a `POST /api/delivery/assign`, mint a Kiszállítás oldalon.
- Ha a napra nincs beosztott futár, a rendelés helyszíni átvételre váltható (`POST /api/delivery/to-pickup`). A kiszállítási díj törléséről a felhasználó dönt egy jelölőnégyzettel; megerősítést kér.
- Futárt kiosztani és átvételre váltani tulajdonos, admin és diszpécser tud; a konyha csak látja, hogy hiányzik a futár.

## Futárválasztás nélkül — v51
A csomagolásnál megszűnt a futárválasztás és a „Futár hiányzik” jelzés (egy futár van, hozzárendelés nincs). Kész, ellenőrzött kiszállításos rendelésnél „Indulhat” jelzés látszik. A „Helyszíni átvételre váltás” gomb (díj megtartása vagy törlése) a kiszállításos, függő vagy sikertelen kézbesítésű rendeléseknél továbbra is elérhető a tulajdonosnak, adminnak és diszpécsernek.
