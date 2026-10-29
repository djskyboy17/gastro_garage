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
