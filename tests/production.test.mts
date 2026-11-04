import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { suggestedPortions, dayDemand, portionsToIssue, batchNeeds, snapshotOps, lotValue, bcLines, reversalBc, closeLinesError, unbatchedReady, type BcContent } from "../src/modules/production/domain.ts";
// @ts-ignore Node native type stripping
import { renderBcHtml } from "../src/modules/production/bc-print.ts";
// @ts-ignore Node native type stripping
import { allocate, pendingOrder, procurementPlan, emptyOperations } from "../src/modules/inventory/domain.ts";

const order = (id: string, items: { productId: string; quantity: number; ready?: number }[], extra: Record<string, unknown> = {}) => ({
  id, customerId: "c", customerName: "x", address: "", phone: "", date: "2026-11-04", time: "12:00", note: "",
  production: "queued", delivery: "pending", payment: "unpaid", status: "confirmed", revision: 0, createdAt: "",
  items: items.map((i, n) => ({ id: id + n, orderId: id, productId: i.productId, hu: "Gulyás", ro: "Gulaș", allergens: "", quantity: i.quantity, price: 1400, ready: i.ready ?? 0, recipeId: null, setGroup: "" })),
  ...extra,
});
// Gulyásleves: 10 adagos recept, 2000 g hús és egy al-recept (csipetke) – annak v1 és később v2 változata.
const recipe = { id: "r1", productId: "goulash", version: 1, yield: 10, note: "", createdAt: "", lines: [{ id: "l1", recipeId: "r1", ingredientId: "beef", quantity: 2000, lossBps: 0 }], preparations: [{ id: "p1", recipeId: "r1", preparationId: "dough", quantity: 500, lossBps: 0 }] };
const prepV1 = { id: "pv1", preparationId: "dough", version: 1, output: 500, note: "", createdAt: "", lines: [{ id: "x1", versionId: "pv1", ingredientId: "flour", quantity: 400, lossBps: 0 }] };
const prepV2 = { id: "pv2", preparationId: "dough", version: 2, output: 500, note: "", createdAt: "", lines: [{ id: "x2", versionId: "pv2", ingredientId: "flour", quantity: 300, lossBps: 0 }, { id: "x3", versionId: "pv2", ingredientId: "egg", quantity: 2, lossBps: 0 }] };
const lot = (id: string, ingredientId: string, remaining: number, expires: string, totalCost = 0) => ({ id, ingredientId, batch: "B-" + id, supplier: "", received: "2026-11-01", expires, quantity: remaining, remaining, totalCost, document: "", createdAt: "" });

test("Suggested portions are orders plus margin, rounded up", () => {
  assert.equal(suggestedPortions(40, 1000), 44);
  assert.equal(suggestedPortions(41, 1000), 46);
  assert.equal(suggestedPortions(0, 1000), 0);
  assert.equal(suggestedPortions(7, 0), 7);
});

test("Example 1: 40 ordered, 45 actual – materials for 45 portions, FEFO, with value", () => {
  const demand = dayDemand([order("o1", [{ productId: "goulash", quantity: 40 }])] as never, "2026-11-04", new Set());
  assert.deepEqual(demand.get("goulash"), { hu: "Gulyás", ro: "Gulaș", ordered: 40, issued: 0, ready: 0 });
  const needs = batchNeeds(recipe, portionsToIssue(45, 0), [prepV1, prepV2], ["pv1"]);
  assert.equal(needs.get("beef"), 9000);
  assert.equal(needs.get("flour"), 1800);
  assert.equal(needs.has("egg"), false, "the batch keeps the recorded sub-recipe version");
  const lots = [lot("late", "beef", 10000, "2026-11-20", 500000), lot("early", "beef", 4000, "2026-11-06", 160000), lot("f", "flour", 5000, "2026-12-01", 2500)];
  const a = allocate(needs, lots, "2026-11-04");
  assert.deepEqual(a.shortage, []);
  assert.deepEqual(a.allocations.filter((x: { ingredientId: string }) => x.ingredientId === "beef"), [
    { lotId: "early", ingredientId: "beef", quantity: 4000 },
    { lotId: "late", ingredientId: "beef", quantity: 5000 },
  ]);
  const lines = bcLines(needs, needs, a.allocations, lots, [{ id: "beef", ro: "Carne vită", unit: "g" }, { id: "flour", ro: "Făină", unit: "g" }]);
  assert.equal(lines[0]!.value, 160000 + 250000);
  assert.equal(lines[1]!.value, 900);
  assert.equal(lotValue(1, { quantity: 3, totalCost: 100 }), 33);
  assert.equal(lotValue(-1, { quantity: 3, totalCost: 200 }), -67);
});

test("Example 2: portions already issued per order are not consumed again", () => {
  const orders = [order("o1", [{ productId: "goulash", quantity: 35 }]), order("o2", [{ productId: "goulash", quantity: 5 }])];
  const d = dayDemand(orders as never, "2026-11-04", new Set(["o2"]));
  assert.equal(d.get("goulash")!.issued, 5);
  assert.equal(portionsToIssue(45, 5), 40);
  assert.equal(portionsToIssue(3, 5), 0);
  assert.equal(batchNeeds(recipe, 40, [prepV1], ["pv1"]).get("beef"), 8000);
});

test("Example 3: shortage is detected before anything is written", () => {
  const a = allocate(new Map([["beef", 9000]]), [lot("b", "beef", 1000, "2026-11-20")], "2026-11-04");
  assert.deepEqual(a.shortage, [{ ingredientId: "beef", quantity: 8000 }]);
  assert.equal(allocate(new Map([["beef", 10]]), [lot("old", "beef", 1000, "2026-11-03")], "2026-11-04").shortage.length, 1, "expired lots are not used");
});

test("Closing lines must match the recipe; a deviation needs a reason", () => {
  const planned = new Map([["beef", 9000], ["flour", 1800]]);
  assert.equal(closeLinesError(planned, [{ ingredientId: "beef", quantity: 9000 }, { ingredientId: "flour", quantity: 1800 }], ""), null);
  assert.equal(closeLinesError(planned, [{ ingredientId: "beef", quantity: 9500 }, { ingredientId: "flour", quantity: 1800 }], ""), "ACTUAL_NOTE_REQUIRED");
  assert.equal(closeLinesError(planned, [{ ingredientId: "beef", quantity: 9500 }, { ingredientId: "flour", quantity: 1800 }], "több hús ment bele"), null);
  assert.equal(closeLinesError(planned, [{ ingredientId: "beef", quantity: 9000 }], "x"), "INVALID_ITEM");
  assert.equal(closeLinesError(planned, [{ ingredientId: "beef", quantity: 9000 }, { ingredientId: "beef", quantity: 1 }], "x"), "INVALID_ITEM");
  assert.equal(closeLinesError(new Map(), [], ""), null);
});

test("Example 4: BC reversal negates every quantity and value, per lot", () => {
  const content: BcContent = {
    batch: { id: "b1", code: "L261104-ABCD", day: "2026-11-04" },
    product: { ro: "Supă gulaș", hu: "Gulyásleves" },
    portions: { actual: 45, issuedBefore: 5, consumed: 40 },
    recipe: { id: "r1", version: 1 },
    note: "",
    lines: [{ ingredientId: "beef", name: "Carne vită", unit: "g", planned: 8000, quantity: 8000, value: 320000, lots: [{ lotId: "early", batch: "B1", expires: "2026-11-06", quantity: 8000, value: 320000 }] }],
    totalValue: 320000,
  };
  const r = reversalBc(content, "hibás adagszám");
  assert.equal(r.lines[0]!.quantity, -8000);
  assert.equal(r.lines[0]!.lots[0]!.quantity, -8000);
  assert.equal(r.lines[0]!.lots[0]!.lotId, "early");
  assert.equal(r.totalValue, -320000);
  assert.equal(r.reason, "hibás adagszám");
  const html = renderBcHtml(content, "BC-2026-0001");
  assert.match(html, /BON DE CONSUM/);
  assert.match(html, /BC-2026-0001/);
  assert.match(html, /L261104-ABCD/);
  assert.match(html, /din care 5 consumate anterior/);
  assert.match(html, /3\.200,00|3200,00/);
  assert.match(renderBcHtml(r, "BC-2026-0002", { reversalOf: "BC-2026-0001" }), /STORNO la BC-2026-0001 – motiv: hibás adagszám/);
  assert.doesNotMatch(renderBcHtml({ ...content, product: { ro: "<script>x</script>", hu: "" } }, "N"), /<script>x/);
});

test("Example 5: the batch snapshot keeps the recorded sub-recipe version for labels", () => {
  const ops = { ...emptyOperations, preparationVersions: [prepV1, prepV2] };
  const snap = snapshotOps(ops, ["pv1"]);
  assert.deepEqual(snap.preparationVersions.map((v: { id: string }) => v.id), ["pv1"]);
  assert.equal(ops.preparationVersions.length, 2, "original data untouched");
});

test("Example 6: ready without a closed batch is a warning; closed batches leave the procurement plan", () => {
  const orders = [order("o1", [{ productId: "goulash", quantity: 4, ready: 1 }, { productId: "cola", quantity: 1, ready: 1 }]), order("o2", [{ productId: "goulash", quantity: 2, ready: 1 }])];
  const ops = { ...emptyOperations, recipes: [recipe], issues: [] as never[], batches: [] as { day: string; productId: string; status: "open" | "closed" }[] };
  assert.deepEqual(unbatchedReady(orders as never, ops, "2026-11-04").map((p: { productId: string }) => p.productId), ["goulash"], "no warning for dishes without recipe");
  assert.deepEqual(unbatchedReady(orders as never, { ...ops, batches: [{ day: "2026-11-04", productId: "goulash", status: "open" }] }, "2026-11-04").length, 1, "an open batch still warns");
  const closed = { ...ops, batches: [{ day: "2026-11-04", productId: "goulash", status: "closed" as const }] };
  assert.deepEqual(unbatchedReady(orders as never, closed, "2026-11-04"), []);
  assert.deepEqual(unbatchedReady(orders as never, { ...ops, issues: [{ id: "i", orderId: "o1", recipeSnapshot: "", createdAt: "", actor: "" }, { id: "j", orderId: "o2", recipeSnapshot: "", createdAt: "", actor: "" }] }, "2026-11-04"), [], "per-order issue counts as covered");
  assert.equal(pendingOrder(orders[0] as never, closed.batches).items.length, 1);
  const pending = order("o3", [{ productId: "goulash", quantity: 10 }]);
  const withStock = { ...ops, ingredients: [{ id: "beef", hu: "Marha", ro: "Vită", unit: "g", packQuantity: 1000, packPrice: 4000, minStock: 0, allergens: "", supplier: "" }], preparationVersions: [prepV1] };
  assert.equal(procurementPlan([pending] as never, withStock, "2026-11-04").rows[0]!.required, 2000);
  assert.equal(procurementPlan([pending] as never, { ...withStock, batches: closed.batches }, "2026-11-04").rows.length, 0);
});

// @ts-ignore Node native type stripping
import { bulkClosePlan } from "../src/modules/production/domain.ts";

test("v78: closing the day by recipe – ordered portions, open batch's plan, skips closed and recipe-less dishes", () => {
  const plan = bulkClosePlan(
    [
      { productId: "soup", ordered: 12 },
      { productId: "beans", ordered: 1 },
      { productId: "cola", ordered: 3 },
      { productId: "pie", ordered: 4 },
    ],
    [
      { id: "b-soup", productId: "soup", status: "open", planned: 14 },
      { id: "b-pie", productId: "pie", status: "closed", planned: 4 },
      { id: "b-extra", productId: "extra", status: "open", planned: 5 },
    ],
    new Set(["soup", "beans", "pie", "extra"]),
  );
  assert.deepEqual(plan.steps, [
    { productId: "soup", batchId: "b-soup", actual: 14 },
    { productId: "beans", batchId: null, actual: 1 },
    { productId: "extra", batchId: "b-extra", actual: 5 },
  ]);
  assert.deepEqual(plan.noRecipe, ["cola"]);
});
