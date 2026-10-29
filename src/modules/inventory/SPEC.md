# Inventory, recipes and procurement

## Scope

Ingredient masters have HU/RO names, immutable base units (g/ml/pieces), a reference pack quantity/price, minimum stock and declared allergens. Quantities are integers in the base unit; money is integer bani. Ingredient editing and nested subrecipes are deferred.

Recipes have immutable numbered versions, a yield in portions, ingredient net quantities and cleaning-loss basis points. Gross scaled requirement is rounded upward once per recipe line using integer arithmetic. New order items capture the latest recipe ID; old/null items explicitly use the current recipe at issue time. The issue request includes the previewed recipe IDs to reject stale previews. Ingredient allergens are conservatively added to the catalog declaration, never removed. Historical order allergen declarations are unchanged.

Receipts create immutable lot identification, supplier, expiry/receipt dates, received quantity and cost plus a positive stock movement. Lot balance is mutable only through documented inventory operations. Receipts have request UUID idempotency. Expired lots remain visible but unusable for production; a receipt may describe a past receipt but cannot be future-dated.

Production issue is per order, explicit and at most once. User can specify actual quantities for exactly the required ingredients; any changed quantity requires a note. Eligible orders are confirmed, queued/cooking and not dispatched. FEFO allocates today's valid lots. The atomic D1 batch stores the recipe/quantity snapshot, checks the order revision, starts cooking, deducts lot balances, stores negative movements and audit. A database CHECK prevents negative balances; failed concurrent deductions roll the whole batch back. No stock moves on order creation or kitchen-ready marking. Current limit is 35 allocated lots per issue; larger issues are rejected without partial writes.

Waste is a separate idempotent, reason-required negative movement, including disposal of expired lots. It uses the same nonnegative balance constraint and atomic audit. No delete or reversal feature yet.

Procurement is a calculated, exportable daily proposal. Exclude cancelled, prepared and already-issued orders. Count lots valid on the selected day, exclude future receipts, report missing recipes explicitly. Optional minimum stock replenishment is added after demand. Confirmed outstanding purchase quantities due by the planning day reduce the new purchase suggestion in a separate incoming column; they are not available stock. No cross-day reservation is assumed. The linked internal purchase/partial-receipt workflow is described in ../purchasing/SPEC.md. Cost is a reference ingredient estimate only; receipt values and recipe estimates are not tax/accounting calculations.

## Endpoints

- GET /api/data includes operations data and the latest 200 movements.
- POST /api/operations/ingredients
- POST /api/operations/recipes
- POST /api/operations/receive
- POST /api/operations/issue
- POST /api/operations/waste
- POST /api/operations/demo: explicit simplified sample recipes/stock, inserts deterministic IDs without resetting existing balances. Requires the base demo catalog.

## Verification

Exact scaling/rounding, expiry/FEFO, missing recipes, captured recipe version, shortage/minimum and no-mutating planning are covered by domain tests. API smoke tests cover receipt replay, issue replay, failed issue no writes, parallel issue/waste balance protection, immutable recipe linkage, missing recipe rejection and movement-to-order traceability. Browser tests exercise the user approval flow and HU/RO labels.
