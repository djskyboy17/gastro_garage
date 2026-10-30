import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node's native type stripping resolves this test import.
import {
  kitchenSummary,
  readyPortions,
  total,
  nextState,
  normalizeSearch,
  type Order,
} from "../src/modules/shared/domain.ts";
const base: Order = {packingReady:1,
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
  let o = nextState({ ...base, courierId: "courier-test" }, "production", "cooking");
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
test("Kitchen shows remaining portions per item and lists only unfinished item ids", () => {
  const two = { ...base, id: "o2", items: [{ ...base.items[0]!, id: "i2", orderId: "o2", quantity: 5, ready: 1 }, { ...base.items[0]!, id: "i3", orderId: "o2", productId: "p2", hu: "Főétel", ro: "Fel principal", quantity: 2 }] };
  const rows = kitchenSummary([base, two]);
  const soup = rows.find((r) => r.productId === "p1")!;
  assert.equal(soup.quantity, 8);
  assert.equal(soup.ready, 5);
  assert.equal(soup.remaining, 3);
  assert.deepEqual(soup.pendingItemIds, ["i1"]);
  assert.deepEqual(rows.find((r) => r.productId === "p2")!.pendingItemIds, ["i3"]);
  assert.equal(readyPortions(two), 5);
  // A teljesen kész rendelés minden tétele kész, akkor is, ha tételenként nincs jelölve.
  assert.equal(readyPortions({ ...base, production: "ready" }), 3);
  // A kész étel a lista végére kerül.
  const done = kitchenSummary([{ ...base, production: "ready" }, { ...base, id: "o4", items: [{ ...base.items[0]!, id: "i4", productId: "p9", quantity: 1 }] }]);
  assert.deepEqual(done.map((r) => r.remaining), [1, 0]);
});

test("Staff status follows the customer journey: accepted → cooking → ready → awaiting courier → transit → completed", async () => {
  // @ts-ignore Node native type stripping
  const { orderStage } = await import("../src/modules/shared/domain.ts");
  const base = { status: "confirmed", production: "queued", delivery: "pending", fulfillmentMode: "delivery", packingReady: 0 };
  const key = (o: object) => orderStage({ ...base, ...o }).key;
  assert.equal(key({ status: "requested" }), "stageRequested");
  assert.equal(key({}), "stageAccepted");
  assert.equal(key({ production: "cooking" }), "stageCooking");
  assert.equal(key({ production: "ready" }), "stageReady");
  assert.equal(key({ production: "ready", packingReady: 1 }), "stageAwaitingCourier");
  assert.equal(key({ production: "ready", packingReady: 1, delivery: "transit" }), "stageTransit");
  assert.equal(key({ production: "ready", delivery: "failed" }), "stageFailed");
  assert.equal(key({ production: "ready", delivery: "delivered" }), "stageCompleted");
  assert.equal(key({ status: "cancelled" }), "cancelled");
  // Személyes átvétel: elkészült → átvehető → teljesítve, futár nélkül.
  assert.equal(key({ fulfillmentMode: "pickup", production: "ready", packingReady: 1 }), "stagePickupReady");
  assert.equal(key({ fulfillmentMode: "pickup", delivery: "delivered" }), "stageCompleted");
  const s = orderStage({ ...base, production: "cooking" });
  assert.deepEqual([s.step, s.steps], [2, 6]);
  assert.equal(orderStage({ ...base, fulfillmentMode: "pickup", delivery: "delivered" }).step, 5);
});

test("Overview cards: orange when nothing is done, yellow in progress, green when all done", async () => {
  // @ts-ignore Node native type stripping
  const { overviewCards, statusLevel } = await import("../src/modules/shared/domain.ts");
  assert.deepEqual([statusLevel(0, 0), statusLevel(0, 3), statusLevel(1, 3), statusLevel(3, 3)], ["empty", "todo", "progress", "done"]);
  const item = (q: number, ready = 0) => ({ id: "i" + q, orderId: "o", productId: "p", hu: "x", ro: "x", allergens: "", quantity: q, price: 100, ready });
  const o = (x: object) => ({ id: "o", customerId: "c", customerName: "n", address: "", phone: "", date: "2026-11-02", time: "12:00", note: "", production: "queued", delivery: "pending", payment: "unpaid", status: "confirmed", revision: 0, createdAt: "", fulfillmentMode: "delivery", packingReady: 0, items: [item(2)], ...x });
  const cards = overviewCards([
    o({ status: "requested" }),
    o({ production: "ready", packingReady: 1, delivery: "transit" }),
    o({ production: "cooking" }),
    o({ status: "cancelled" }),
  ]);
  type Card = { key: string; done: number; total: number; extra: number; level: string };
  const by: Record<string, Card> = Object.fromEntries(cards.map((c: Card) => [c.key, c]));
  assert.deepEqual([by.orders.done, by.orders.total, by.orders.extra, by.orders.level], [2, 3, 1, "progress"]);
  assert.deepEqual([by.kitchen.done, by.kitchen.total, by.kitchen.level], [2, 4, "progress"]);
  assert.deepEqual([by.packing.done, by.packing.total, by.packing.level], [1, 2, "progress"]);
  assert.deepEqual([by.delivery.done, by.delivery.total, by.delivery.extra, by.delivery.level], [0, 2, 1, "todo"]);
});
