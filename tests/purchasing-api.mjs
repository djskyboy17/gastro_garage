import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const origin = "http://127.0.0.1:5173";
const login = await fetch(origin + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
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
  return { status: r.status, data: await r.json() };
}
async function post(path, body, status = 201) {
  const r = await call("purchasing/" + path, body);
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
const state = async () => (await call("data")).data;
const date = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Bucharest",
}).format(new Date());
const supplierId = randomUUID();
await post("suppliers", {
  id: supplierId,
  name: "LOCAL PURCHASE TEST " + supplierId.slice(0, 5),
  taxId: "",
  address: "Example address",
  email: "",
  phone: "",
  note: "Local test only",
});
const ing = (await state()).operations.ingredients[0];
assert.ok(ing);
const id = randomUUID();
const input = {
  id,
  supplierId,
  due: date,
  note: "Local PO test",
  lines: [
    {
      ingredientId: ing.id,
      quantity: 1000,
      packQuantity: 1000,
      packPrice: 1500,
    },
  ],
};
await post("create", input);
await post("create", input, 200);
let data = await state(),
  p = data.purchasing.orders.find((p) => p.id === id);
assert.equal(p.lines[0].received, 0);
const beforeStock = data.operations.lots
  .filter((l) => l.ingredientId === ing.id)
  .reduce((s, l) => s + l.remaining, 0);
const receipt = {
  id: randomUUID(),
  purchaseId: id,
  revision: 0,
  lineId: p.lines[0].id,
  quantity: 400,
  batch: "TEST-PART-1",
  received: date,
  expires: "2099-01-01",
  totalCost: 650,
  document: "TEST",
};
assert.equal(
  (await post("receive", receipt, 400)).error,
  "PURCHASE_TRANSITION",
);
await post("update", { ...input, revision: 0, note: "edited draft" }, 200);
await post("update", { ...input, revision: 0 }, 409);
await post("state", { id, revision: 1, action: "confirm", note: "" }, 200);
data = await state();
p = data.purchasing.orders.find((p) => p.id === id);
const receive1 = { ...receipt, revision: 2, lineId: p.lines[0].id };
await post("receive", receive1);
await post("receive", receive1, 200);
await post("receive", { ...receive1, quantity: 401 }, 409);
await post("receive", { ...receive1, purchaseId: randomUUID() }, 409);
data = await state();
p = data.purchasing.orders.find((p) => p.id === id);
assert.equal(p.lines[0].received, 400);
assert.equal(p.revision, 3);
assert.equal(
  data.operations.lots
    .filter((l) => l.ingredientId === ing.id)
    .reduce((s, l) => s + l.remaining, 0),
  beforeStock + 400,
);
assert.equal(
  data.operations.lots.find((l) => l.id === receive1.id).totalCost,
  650,
);
assert.equal(
  data.operations.lots.find((l) => l.id === receive1.id).purchaseLineId,
  p.lines[0].id,
);
await post(
  "receive",
  { ...receive1, id: randomUUID(), revision: 3, quantity: 601 },
  400,
);
await post("state", { id, revision: 3, action: "cancel", note: "" }, 400);
const receipt2 = {
  ...receive1,
  id: randomUUID(),
  revision: 3,
  quantity: 600,
  batch: "TEST-PART-2",
  totalCost: 900,
};
const race = await Promise.all([
  call("purchasing/receive", receipt2),
  call("purchasing/receive", { ...receipt2, id: randomUUID() }),
]);
assert.equal(race.filter((r) => r.status === 201).length, 1);
assert.ok(race.some((r) => r.status === 409 || r.status === 400));
data = await state();
p = data.purchasing.orders.find((p) => p.id === id);
assert.equal(p.lines[0].received, 1000);
assert.equal(p.revision, 4);
assert.equal(
  data.operations.lots.filter((l) => l.purchaseLineId === p.lines[0].id).length,
  2,
);
assert.equal(
  data.purchasing.events.filter(
    (e) => e.purchaseId === id && e.kind === "receipt",
  ).length,
  2,
);
await post(
  "receive",
  { ...receipt2, id: randomUUID(), revision: 4, quantity: 1 },
  400,
);
const other = randomUUID();
await post("create", { ...input, id: other });
await post(
  "state",
  { id: other, revision: 0, action: "confirm", note: "" },
  200,
);
data = await state();
const line = data.purchasing.orders.find((p) => p.id === other).lines[0];
await post("receive", {
  ...receipt,
  id: randomUUID(),
  purchaseId: other,
  revision: 1,
  lineId: line.id,
  quantity: 100,
});
await post("state", { id: other, revision: 2, action: "close", note: "" }, 400);
await post(
  "state",
  {
    id: other,
    revision: 2,
    action: "close",
    note: "Supplier will not ship the rest",
  },
  200,
);
await post(
  "receive",
  {
    ...receipt,
    id: randomUUID(),
    purchaseId: other,
    revision: 3,
    lineId: line.id,
    quantity: 1,
  },
  400,
);
console.log(
  "PASS: supplier and draft creation, immutable price snapshot, draft editing, revision conflict, draft receipt denial, confirmation without stock increase, partial receipts, receipt replay, over-receipt denial, concurrent receipt rollback, complete receipt and closing remainder",
);
