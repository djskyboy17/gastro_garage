# Inventory, recipes and procurement

## Scope

Ingredient masters have HU/RO names, immutable base units (g/ml/pieces), a reference pack quantity/price, minimum stock and declared allergens. Quantities are integers in the base unit; money is integer bani. Pack data and base unit are not editable; nutrition, frozen flag, piece weight and allergens are (see Preparations and nutrition).

Recipes have immutable numbered versions, a yield in portions, ingredient net quantities and cleaning-loss basis points. Gross scaled requirement is rounded upward once per recipe line using integer arithmetic. New order items capture the latest recipe ID; old/null items explicitly use the current recipe at issue time. The issue request includes the previewed recipe IDs to reject stale previews. Ingredient allergens are conservatively added to the catalog declaration, never removed. Historical order allergen declarations are unchanged.

Receipts create immutable lot identification, supplier, expiry/receipt dates, received quantity and cost plus a positive stock movement. Lot balance is mutable only through documented inventory operations. Receipts have request UUID idempotency. Expired lots remain visible but unusable for production; a receipt may describe a past receipt but cannot be future-dated.

Production issue is per order, explicit and at most once. Since v73 a per-order issue is rejected (`ISSUE_BATCHED`, also re-checked inside the D1 batch) when a production batch exists for the order date and any of its dishes; that dish is then consumed by the batch (see ../production/SPEC.md). Procurement plans treat dishes of closed batches as already consumed. User can specify actual quantities for exactly the required ingredients; any changed quantity requires a note. Eligible orders are confirmed, queued/cooking and not dispatched. FEFO allocates today's valid lots. The atomic D1 batch stores the recipe/quantity snapshot, checks the order revision, starts cooking, deducts lot balances, stores negative movements and audit. A database CHECK prevents negative balances; failed concurrent deductions roll the whole batch back. No stock moves on order creation or kitchen-ready marking. Current limit is 35 allocated lots per issue; larger issues are rejected without partial writes.

Waste is a separate idempotent, reason-required negative movement, including disposal of expired lots. It uses the same nonnegative balance constraint and atomic audit. No delete or reversal feature yet.

Procurement is a calculated, exportable daily proposal. Exclude cancelled, prepared and already-issued orders. Count lots valid on the selected day, exclude future receipts, report missing recipes explicitly. Optional minimum stock replenishment is added after demand. Confirmed outstanding purchase quantities due by the planning day reduce the new purchase suggestion in a separate incoming column; they are not available stock. No cross-day reservation is assumed. The linked internal purchase/partial-receipt workflow is described in ../purchasing/SPEC.md. Cost is a reference ingredient estimate only; receipt values and recipe estimates are not tax/accounting calculations.

## Preparations (sub-recipes) and nutrition — v15

Preparations are semi-finished items (stock, sauce, dough) with HU/RO names and an immutable output unit (g or ml). Each has immutable numbered versions: an integer output quantity in that unit and ingredient lines (net quantity, loss basis points). Preparations contain ingredients only; a preparation inside a preparation is not supported, so cycles cannot occur. Preparations are made on the day and are not stock items: they have no lots, receipts or movements.

A dish recipe version may contain ingredient lines and preparation lines (at least one line in total, at most 25 of each; a preparation at most once). A preparation line states the net quantity of the preparation per recipe yield and its loss. Recipe preparation lines reference the preparation, not a version: calculations always use the latest preparation version. Issue snapshots record the preparation version IDs used; the issue request's recipe ID list also contains `prep:<versionId>` entries, so a preparation change between preview and issue is rejected as stale.

Explosion: the gross preparation quantity is `grossQuantity(q, loss, portions, yield)`; each preparation ingredient's gross requirement is `grossQuantity(n, l, grossPreparation, output)`. Both steps round up (conservative). Issue, procurement proposal and recipe cost use this explosion. A missing preparation version is reported as a missing recipe; issue is rejected.

Allergens stay conservative: saving a recipe or a preparation version adds the ingredient allergens (through preparations too) to the affected dishes; nothing is removed automatically. Editing an ingredient's allergens adds new allergens to the dishes whose latest recipe uses it.

Ingredients have optional nutrition per 100 g (per 100 ml for ml ingredients): energy kJ and kcal, fat, saturates, carbohydrate, sugars, protein, salt. Values are stored as integers in hundredths (2.20 g → 220). Ingredients also have a frozen flag and, for piece units, an optional weight per piece in grams. These fields and the allergens can be edited later; the base unit cannot.

Dish information is calculated from the dish's latest recipe: the ingredient list in descending net weight, preparations as composite entries with their ingredients in brackets, frozen ingredients marked with `*`, allergens (ingredient allergens through preparations, plus the dish's declared allergens), and nutrition per 100 g of finished product. Finished weight = recipe yield × dish portion weight (grams). Assumption: ml counts as grams (density 1) for weight; pieces need the weight per piece. If any ingredient lacks nutrition (or a piece weight), nutrition is not shown and the missing ingredients are listed. The information is calculated, not approved: there is no approval workflow yet, and additives are not recorded yet.

Acceptance examples:

1. Stock: 2000 g bones → 5000 ml. A soup recipe (yield 1) uses 300 ml stock → issue/procurement requires 120 g bones.
2. A dish uses a sauce preparation containing cream (milk); saving the recipe adds milk to the dish allergens.
3. Ingredients 250 g at 100 kcal/100 g and 250 g at 60 kcal/100 g; yield 2 portions of 200 g → 100 kcal per 100 g.
4. One ingredient without nutrition → no nutrition values; that ingredient is listed as missing.
5. A new preparation version after an issue preview → issue rejected with conflict.

## Endpoints

- GET /api/data includes operations data and the latest 200 movements.
- POST /api/operations/ingredients
- POST /api/operations/recipes (ingredient lines and optional preparation lines)
- POST /api/operations/ingredient-details: nutrition, frozen, weight per piece, allergens of an existing ingredient
- POST /api/operations/preparations: new preparation (or new version of an existing one)
- POST /api/operations/receive
- POST /api/operations/issue
- POST /api/operations/waste
- POST /api/operations/demo: explicit simplified sample recipes/stock, inserts deterministic IDs without resetting existing balances. Requires the base demo catalog.

## Verification

Exact scaling/rounding, expiry/FEFO, missing recipes, captured recipe version, shortage/minimum and no-mutating planning are covered by domain tests. API smoke tests cover receipt replay, issue replay, failed issue no writes, parallel issue/waste balance protection, immutable recipe linkage, missing recipe rejection and movement-to-order traceability. Browser tests exercise the user approval flow and HU/RO labels.

## Halasztott napi gyártási anyagkiadás – 2026-11-06

A nyersanyag könyv szerinti készlete az elkészült adagszám mentésétől még nem változik; a production modul napi zárása véglegesíti a mozgásokat. A régi rendelésenkénti POST /api/operations/issue 410 USE_DAILY_MATERIALS választ ad, a régi stock_issues története olvasható marad.

A loadOperations.deferredNeeds az elkészült, de még nem könyvelt tételek rögzített anyagigénye. A napi procurementPlan ehhez hozzáadja a még el nem készített rendelések igényét; az előretekintő terv is egyszer számolja a függő anyagigényt. Ettől a lot.remaining nem változik, de a beszerzés nem tekinti szabadnak a már felhasznált anyagot. A függő rekordok olvasását részleges index segíti. Nincs recept-visszaszámolás a már rögzített termeléshez.
