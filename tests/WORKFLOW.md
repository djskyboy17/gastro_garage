# Cross-module workflow acceptance

Scope: customer portal, menu availability, staff confirmation, purchasing, inventory/production, dispatch and courier handover. No external payment, messaging, navigation or database backup is triggered.

Run against the existing **local preview** at `http://127.0.0.1:5173` with its local sign-in simulation and migrated D1 database. Set `KITCHEN_TEST_PYTHON` to the local Python executable. Never run fixtures against hosted data. The fixtures only locate the project's `.wrangler/state/v3/d1` database and synthetic `local_*` users. They restore the local owner's identity in `finally`.

```text
node tests/workflow-api.mjs
python tests/workflow-db.py
```

The test creates unique fictitious ingredient, bilingual dish/recipe, customer profile and tomorrow's menu. It configures **local** fulfillment test rules, adds a menu line without removing existing lines and resets the synthetic account's submission quota. These local configuration/data changes remain after the test; this is not a pristine database reset.

Acceptance examples:

1. Customer requests two 25 RON portions. A repeated identical request creates one order. The requested order reserves menu capacity but does not create or deduct stock; cooking before staff confirmation is rejected.
2. After confirmation, insufficient stock rejects the issue without starting cooking. A supplier purchase is confirmed and received into a traceable 1000g lot. Replaying receipt does not duplicate stock.
3. A later recipe version doubles planned use, and the customer changes their address. This order still uses its captured original recipe, address, item names, price and allergens. Issuing its two portions consumes exactly 200g. Replay creates no second issue or deduction; 800g remains.
4. Stale readiness updates are rejected. Ready food receives a complete packing checklist, then is assigned to a courier and appears in that courier's scoped task API. Departure and handover persist once, leaving payment unchanged.
5. Staff and customer APIs agree after reload. Read-only SQL verifies the saved order, captured recipe, supplier-linked lot, one issue and its negative movement. Foreign keys remain valid.

Browser-assisted variant:

```text
node tests/workflow-api.mjs setup
# Submit exactly two portions of the printed dish with the printed note in /portal.
node tests/workflow-api.mjs staff
python tests/courier-fixture.py driver
# In /courier choose the printed date, depart and mark delivered.
node tests/workflow-api.mjs verify
python tests/workflow-db.py
# Reload /portal and inspect the same order in HU and RO.
```

`work/workflow-context.json` contains only local test identifiers and is ignored by Git. No fixture code is reachable from the application or grants hosted impersonation.

Verified 2026-10-29: full API chain and browser-assisted chain passed. The browser submitted in Romanian, departed in Romanian, handed over in Hungarian and reloaded the customer's completed order in both languages. Native date-picker selection was used for the courier date; automated date `fill` alone did not commit the browser's date change.
