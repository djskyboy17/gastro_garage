import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node's native type stripping resolves this test import.
import {
  kitchenSummary,
  total,
  nextState,
  normalizeSearch,
  type Order,
} from "../src/modules/shared/domain.ts";
const base: Order = {
  id: "o1",
  customerId: "c1",
  customerName: "Example",
  address: "Example",
  phone: "",
  date: "2026-10-29",
  time: "12:00",
  note: "",
  production: "queued",
  delivery: "pending",
  payment: "unpaid",
  status: "confirmed",
  revision: 0,
  createdAt: "2026-10-29T08:00:00Z",
  items: [
    {
      id: "i1",
      orderId: "o1",
      productId: "p1",
      hu: "Leves",
      ro: "Supă",
      allergens: "milk",
      quantity: 3,
      price: 1099,
    },
  ],
};
test("Money totals use integer bani without floating-point drift", () => {
  assert.equal(total(base), 3297);
});
test("Kitchen sums active orders, counts ready portions and excludes cancellations", () => {
  const rows = kitchenSummary([
    base,
    { ...base, id: "o2", production: "ready" },
    { ...base, id: "o3", status: "cancelled" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 6);
  assert.equal(rows[0].ready, 3);
});
test("Changed allergen snapshots remain separate kitchen rows", () => {
  assert.equal(
    kitchenSummary([
      base,
      { ...base, items: base.items.map((i) => ({ ...i, allergens: "egg" })) },
    ]).length,
    2,
  );
});
test("Unprepared food cannot be dispatched", () => {
  assert.throws(() => nextState(base, "delivery", "transit"), /NOT_READY/);
});
test("Prepared food goes through dispatch and delivery without changing payment", () => {
  let o = nextState(base, "production", "cooking");
  o = nextState(o, "production", "ready");
  o = nextState(o, "delivery", "transit");
  o = nextState(o, "delivery", "delivered");
  assert.equal(o.payment, "unpaid");
  assert.equal(o.revision, 4);
  assert.throws(
    () => nextState(o, "delivery", "transit"),
    /INVALID_TRANSITION/,
  );
});
test("Started production cannot be cancelled and cancelled orders are immutable", () => {
  assert.throws(
    () => nextState({ ...base, production: "cooking" }, "status", "cancelled"),
    /ALREADY_STARTED/,
  );
  const c = nextState(base, "status", "cancelled");
  assert.throws(() => nextState(c, "payment", "paid"), /CANCELLED/);
});
test("Romanian cedilla/comma and Hungarian accent searches normalize", () => {
  assert.equal(normalizeSearch("ȘȚşţ ŐŰ"), normalizeSearch("stst ou"));
});
