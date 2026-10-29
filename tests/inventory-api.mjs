import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const origin = "http://127.0.0.1:5173";
const auth = await fetch(origin + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = auth.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
async function call(path, body) {
  const r = await fetch(origin + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  return { status: r.status, data };
}
const state = async () => (await call("data")).data;
const post = async (path, body, status = 201) => {
  const r = await call("operations/" + path, body);
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
const key = randomUUID().slice(0, 8);
const ing = await post("ingredients", {
  hu: "API liszt " + key,
  ro: "API făină " + key,
  unit: "g",
  packQuantity: 1000,
  packPrice: 500,
  minStock: 100,
  supplier: "TEST",
  allergens: "gluten",
});
const dish = await call("products", {
  hu: "API étel " + key,
  ro: "API preparat " + key,
  descriptionHu: "",
  descriptionRo: "",
  category: "main",
  price: 2000,
  portion: 300,
  allergens: "",
});
assert.equal(dish.status, 201);
const recipe1 = await post("recipes", {
  productId: dish.data.id,
  yield: 10,
  note: "v1",
  lines: [{ ingredientId: ing.id, quantity: 1000, lossBps: 0 }],
});
let data = await state();
assert.ok(
  data.products.find((p) => p.id === dish.data.id).allergens.includes("gluten"),
);
const customer = data.customers[0];
assert.ok(customer, "load base demo before testing");
async function createOrder(productId = dish.data.id, quantity = 3) {
  const id = randomUUID();
  const d = await call("orders", {
    id,
    customerId: customer.id,
    date: new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Bucharest",
    }).format(new Date()),
    time: "13:00",
    note: "LOCAL INVENTORY API TEST",
    items: [{ productId, quantity }],
  });
  assert.equal(d.status, 201, JSON.stringify(d.data));
  return id;
}
const orderId = await createOrder();
const recipe2 = await post("recipes", {
  productId: dish.data.id,
  yield: 10,
  note: "v2",
  lines: [{ ingredientId: ing.id, quantity: 2000, lossBps: 0 }],
});
data = await state();
assert.equal(
  data.orders.find((o) => o.id === orderId).items[0].recipeId,
  recipe1.id,
);
assert.equal(
  data.operations.recipes.filter((r) => r.productId === dish.data.id).length,
  2,
);
const issue = {
  orderId,
  revision: 0,
  recipeIds: [recipe1.id],
  note: "",
  actual: [{ ingredientId: ing.id, quantity: 300 }],
};
const missing = await post("issue", issue, 400);
assert.equal(missing.error, "INSUFFICIENT_STOCK");
data = await state();
assert.ok(!data.operations.issues.some((i) => i.orderId === orderId));
assert.equal(data.orders.find((o) => o.id === orderId).revision, 0);
const receiveId = randomUUID();
const received = "2026-01-01";
await post("receive", {
  id: randomUUID(),
  ingredientId: ing.id,
  batch: "EXPIRED",
  supplier: "TEST",
  received,
  expires: "2026-01-02",
  quantity: 10000,
  totalCost: 5000,
  document: "TEST",
});
assert.equal(
  (await post("issue", issue, 400)).error,
  "INSUFFICIENT_STOCK",
  "expired stock cannot cover issue",
);
const receipt = {
  id: receiveId,
  ingredientId: ing.id,
  batch: "VALID",
  supplier: "TEST",
  received,
  expires: "2099-01-01",
  quantity: 500,
  totalCost: 250,
  document: "TEST",
};
await post("receive", receipt);
await post("receive", receipt, 200);
await post(
  "issue",
  { ...issue, actual: [{ ingredientId: ing.id, quantity: 301 }] },
  400,
);
await post("issue", issue);
await post("issue", issue, 200);
data = await state();
assert.equal(
  data.operations.lots.find((l) => l.id === receiveId).remaining,
  200,
);
assert.equal(data.orders.find((o) => o.id === orderId).production, "cooking");
assert.equal(
  data.operations.moves.filter(
    (m) =>
      m.issueId ===
      data.operations.issues.find((i) => i.orderId === orderId).id,
  ).length,
  1,
);
const second = await createOrder();
const third = await createOrder();
const body = (id) => ({
  orderId: id,
  revision: 0,
  recipeIds: [recipe2.id],
  note: "Test actual override",
  actual: [{ ingredientId: ing.id, quantity: 150 }],
});
const race = await Promise.all([
  call("operations/issue", body(second)),
  call("operations/issue", body(third)),
]);
assert.equal(race.filter((r) => r.status === 201).length, 1);
assert.ok(race.some((r) => r.status === 409 || r.status === 400));
data = await state();
assert.equal(
  data.operations.lots.find((l) => l.id === receiveId).remaining,
  50,
);
const loser = [second, third].find(
  (id) => !data.operations.issues.some((i) => i.orderId === id),
);
assert.equal(
  data.orders.find((o) => o.id === loser).revision,
  0,
  "rollback also protects order revision",
);
const wasteId = randomUUID();
const waste = {
  id: wasteId,
  lotId: receiveId,
  quantity: 25,
  note: "TEST loss",
};
await post("waste", waste, 200);
await post("waste", waste, 200);
data = await state();
assert.equal(
  data.operations.lots.find((l) => l.id === receiveId).remaining,
  25,
);
assert.equal(
  (await post("waste", { ...waste, id: randomUUID(), quantity: 26 }, 400))
    .error,
  "INSUFFICIENT_STOCK",
);
console.log(
  "PASS: immutable recipe versions, order recipe capture, allergen union, expired stock exclusion, receipt/issue/waste idempotency, atomic insufficient-stock rollback, concurrency protection, lot→issue→order traceability",
);
