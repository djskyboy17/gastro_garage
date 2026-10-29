import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const origin = "http://127.0.0.1:5173";
const login = await fetch(origin + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "local preview auth cookie");
const call = async (path, body, extra = {}) => {
  const r = await fetch(origin + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { status: r.status, data };
};
assert.equal((await fetch(origin + "/api/data")).status, 401);
assert.equal(
  (await call("demo", {}, { Origin: "https://example.invalid" })).status,
  403,
);
let state = (await call("data")).data;
assert.ok(state.products.length && state.customers.length);
const customer = await call("customers", {
  name: "LOCAL API TEST",
  address: "Example test address",
  phone: "",
  note: "Local automated test only",
});
assert.equal(customer.status, 201);
const p = state.products[0];
const id = randomUUID();
const input = {
  id,
  customerId: customer.data.id,
  date: "2026-10-30",
  time: "12:15",
  note: "LOCAL API TEST",
  items: [{ productId: p.id, quantity: 2 }],
};
assert.equal(
  (await call("orders", { ...input, date: "2026-02-30" })).status,
  400,
);
assert.equal(
  (
    await call("orders", {
      ...input,
      items: [{ productId: p.id, quantity: -1 }],
    })
  ).status,
  400,
);
assert.equal((await call("orders", input)).status, 201);
assert.equal((await call("orders", input)).status, 200);
state = (await call("data")).data;
const o = state.orders.find((o) => o.id === id);
assert.equal(state.orders.filter((o) => o.id === id).length, 1);
assert.equal(o.items[0].price, p.price);
assert.equal(o.items[0].allergens, p.allergens);
assert.equal(
  (
    await call("orders/state", {
      id,
      revision: 0,
      field: "delivery",
      value: "transit",
    })
  ).status,
  400,
);
const race = await Promise.all([
  call("orders/state", {
    id,
    revision: 0,
    field: "production",
    value: "cooking",
  }),
  call("orders/state", {
    id,
    revision: 0,
    field: "production",
    value: "cooking",
  }),
]);
assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
for (const [revision, field, value] of [
  [1, "production", "ready"],
  [2, "delivery", "transit"],
  [3, "delivery", "delivered"],
])
  assert.equal(
    (await call("orders/state", { id, revision, field, value })).status,
    200,
  );
state = (await call("data")).data;
const after = state.orders.find((o) => o.id === id);
assert.equal(after.delivery, "delivered");
assert.equal(after.payment, "unpaid");
assert.equal(after.revision, 4);
const logs = state.audit.filter((a) => a.entity === id);
assert.equal(logs.filter((a) => a.action === "state_changed").length, 4);
console.log(
  "PASS: auth, same-origin protection, validation, atomic order snapshots, duplicate prevention, revision conflict, kitchen→delivery, independent payment and atomic audit",
);
