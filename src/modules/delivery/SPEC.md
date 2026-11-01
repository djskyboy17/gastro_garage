# Delivery dispatch, v4

Boundaries: courier master data, order assignment, chronological daily manifests and recorded delivery results. Shared order transitions own readiness and delivery states. No route optimization, GPS, electronic signatures or cash reconciliation. Dedicated courier accounts are implemented in ../courier/SPEC.md.

All actions use the existing authenticated, same-origin JSON API. Testers share the test workspace; assigning a courier does not create an account or grant access.

Couriers have a name, optional phone, vehicle reference and note. Creation UUID retries are idempotent; changed payloads with the same ID conflict. Courier names and phone numbers are snapshotted onto orders. Existing orders start unassigned; historical delivery results remain valid.

Assignment and removal are allowed only for confirmed orders with pending or failed delivery. Ready production and an assigned courier are required to enter transit, including retries. Assignment, revision increment, event and audit are atomic. Concurrent stale changes return 409. In-transit and delivered orders cannot be reassigned. Payment remains independent.

Delivery results are operator-recorded statements, not signed proof. Failure requires a nonblank reason; optional delivery note can record handover information. Result events and audit are saved atomically with state changes. The daily list includes order snapshots, food quantities, notes and payment status; filter by courier and delivery state. Printing respects these filters. No external messaging or location sharing occurs.

Acceptance:
1. Create a courier, assign a pending order, reload: both persist with name and phone snapshots.
2. Dispatch without courier or before readiness: reject. Assign while transit or delivered: reject.
3. Mark failure with reason, reassign, dispatch again and mark delivered. Payment stays unchanged. Events preserve the failed attempt and reassignment.
4. Competing assignments at one revision: only one succeeds and only one audit/event is saved.
5. Filter the same day by courier/unassigned and status; completed deliveries remain available. HU/RO labels and printable lists match the selection.

V12: existing dispatcher assignment and state actions remain unchanged. The dedicated courier API applies the same shared transitions with per-account ownership checks. Assigning a courier still does not create a user account or membership.

V14: shared departure and pickup guards additionally require confirmed packing. The daily packing module owns checking/reopening; couriers cannot bypass it. In-transit historical orders can finish without backfilled checks.

V36 — napi beosztás és átvételre váltás:
- `courier_shifts` (dátum + futár): a Kiszállítás oldalon a futártörzsben naponta bejelölhető, ki dolgozik. `POST /api/delivery/shift {date, courierId, onShift}` idempotens; napló: `courier_shift_added` / `courier_shift_removed`. Tartomány: −7…+90 nap.
- A csomagolás csak a beosztott futárokat ajánlja; a javasolt az, akinek aznap a legkevesebb nyitott (nem kézbesített) kiszállítása van.
- `POST /api/delivery/to-pickup {id, revision, removeFee}`: csak visszaigazolt, kiszállításos, függő/sikertelen kézbesítésű rendelés. Mód → átvétel, futár törlése, idősáv-hivatkozás törlése, cím → az átvételi cím (fulfillment beállítás), a pillanatkép frissül. A díj `removeFee` szerint 0 vagy változatlan. Esemény (`to_pickup`), napló (`fulfillment_switched_pickup`, régi és új díjjal) és revizió-növelés egy kötegben; elavult revizió → 409.
- [FELTÉTELEZÉS] Az átvételre váltás szerveroldalon akkor is engedélyezett, ha van beosztott futár (pl. az ügyfél kéri); a felület csak beosztott futár hiányában kínálja fel.
- Jogosultság: tulajdonos, admin, diszpécser.

## Egy futár: futártörzs, hozzárendelés, napi beosztás és napi futárlista nélkül — v51
- Megszűnt: a futártörzs (`couriers`), a napi beosztás (`courier_shifts`), a rendelésenkénti futár-hozzárendelés (`orders.courier_id`, `POST /api/delivery/assign`), a futár létrehozása (`POST /api/delivery/couriers`), a beosztás (`POST /api/delivery/shift`) és a Kiszállítás oldal „Napi futárlista” panele (futár- és állapotszűrő, nyomtatható összesítő).
- Indulás (`transit`) futár-hozzárendelés nélkül lehetséges; a többi feltétel (kész étel, ellenőrzött csomagolás) változatlan. Induláskor a rendelésre a futár neve kerül: a futár saját indításánál az ő neve, a fő alkalmazásból indítva a futár szerepkörű felhasználó neve (`courierUserName`, több ilyen fióknál a legrégebbi).
- A Kiszállítási sor oldal a nap kiszállításait mutatja időrendben, állapotjelzéssel; a rendelés részleteiben a futár neve és a kiszállítási előzmények látszanak.
- Megmaradt: átvételre váltás (`POST /api/delivery/to-pickup`), a csomagolás oldaláról, szállítási díj megtartásával vagy törlésével.
- Adatbázis: `0024_remove_courier_registry` – a rendelések táblája újraépül `courier_id` nélkül; a rendelésekre hivatkozó adagkorlát-triggerek és a kézzel létrehozott index ugyanazzal a definícióval visszakerülnek. A régi rendelések futárneve (`courier_name`) megmarad.
