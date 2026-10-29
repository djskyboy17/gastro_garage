import { test } from "node:test";
import assert from "node:assert/strict";
import {
  grossQuantity,
  allocate,
  requirements,
  procurementPlan,
  costFor,
  recipeCost,
  type Recipe,
  type OperationsData,
  type StockLot,
} from "../src/modules/inventory/domain.ts";
import type { Order } from "../src/modules/shared/domain.ts";
const lot = (id: string, remaining: number, expires: string): StockLot => ({
  id,
  ingredientId: "i",
  batch: id,
  supplier: "Example",
  received: "2026-10-01",
  expires,
  quantity: remaining,
  remaining,
  totalCost: 1000,
  document: "",
  createdAt: "",
});
const r: Recipe = {
  id: "r1",
  productId: "p",
  version: 1,
  yield: 10,
  note: "",
  createdAt: "",
  lines: [
    {
      id: "l",
      recipeId: "r1",
      ingredientId: "i",
      quantity: 900,
      lossBps: 1000,
    },
  ],
};
const order: Order = {
  id: "o",
  customerId: "c",
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
  createdAt: "",
  items: [
    {
      id: "ol",
      orderId: "o",
      productId: "p",
      hu: "Example",
      ro: "Exemplu",
      quantity: 3,
      price: 1000,
      allergens: "",
      recipeId: "r1",
    },
  ],
};
const ops: OperationsData = {
  ingredients: [
    {
      id: "i",
      hu: "Répa",
      ro: "Morcov",
      unit: "g",
      packPrice: 500,
      packQuantity: 1000,
      minStock: 100,
      allergens: "",
      supplier: "",
    },
  ],
  recipes: [r],
  lots: [lot("valid", 200, "2026-11-02"), lot("expired", 1000, "2026-10-28")],
  issues: [],
  moves: [],
};
test("Scale recipes and yield loss with exact upward rounding", () => {
  assert.equal(grossQuantity(900, 1000, 3, 10), 300);
  assert.equal(grossQuantity(100, 0, 1, 3), 34);
  assert.equal(grossQuantity(1, 9000, 1, 1), 10);
  assert.throws(() => grossQuantity(100, 10000, 1, 1));
});
test("Reference costs round bani upwards", () => {
  assert.equal(costFor(101, 500, 1000), 51);
});
test("Per-portion cost divides the whole recipe batch, without rounding half an egg up per serving", () => {
  const eggs = {
    ...ops.ingredients[0],
    unit: "pcs",
    packQuantity: 1,
    packPrice: 100,
  };
  const recipe = { ...r, lines: [{ ...r.lines[0], quantity: 5, lossBps: 0 }] };
  assert.equal(recipeCost(recipe, [eggs]), 50);
});
test("Procurement does not reorder ingredients for already prepared food", () => {
  assert.equal(
    procurementPlan([{ ...order, production: "ready" }], ops, "2026-10-29").rows
      .length,
    0,
  );
});
test("FEFO uses earliest valid lots and excludes expired and future receipts", () => {
  const future = {
    ...lot("future", 900, "2026-12-01"),
    received: "2026-11-01",
  };
  const result = allocate(
    new Map([["i", 450]]),
    [
      lot("later", 300, "2026-11-05"),
      lot("soon", 200, "2026-10-30"),
      lot("old", 1000, "2026-10-28"),
      future,
    ],
    "2026-10-29",
  );
  assert.deepEqual(
    result.allocations.map((a) => [a.lotId, a.quantity]),
    [
      ["soon", 200],
      ["later", 250],
    ],
  );
  assert.equal(result.shortage.length, 0);
});
test("Insufficient valid stock is explicit and planning does not mutate lots", () => {
  const result = allocate(new Map([["i", 300]]), ops.lots, "2026-10-29");
  assert.equal(result.shortage[0].quantity, 100);
  assert.equal(ops.lots[0].remaining, 200);
});
test("Captured recipe remains stable after a newer version is saved", () => {
  const r2 = {
    ...r,
    id: "r2",
    version: 2,
    lines: r.lines.map((l) => ({ ...l, quantity: 1800 })),
  };
  assert.equal(requirements(order, [r, r2]).needs.get("i"), 300);
  const oldOrder = {
    ...order,
    items: order.items.map((i) => ({ ...i, recipeId: null })),
  };
  assert.equal(requirements(oldOrder, [r, r2]).needs.get("i"), 600);
});
test("Procurement excludes issued and cancelled orders; includes optional minimum", () => {
  let p = procurementPlan(
    [order, { ...order, id: "cancel", status: "cancelled" }],
    ops,
    "2026-10-29",
  );
  assert.equal(p.rows[0].required, 300);
  assert.equal(p.rows[0].shortage, 100);
  assert.equal(
    procurementPlan([order], ops, "2026-10-29", true).rows[0].shortage,
    200,
  );
  assert.equal(
    procurementPlan(
      [order],
      {
        ...ops,
        issues: [
          {
            id: "is",
            orderId: "o",
            recipeSnapshot: "{}",
            actor: "u",
            createdAt: "",
          },
        ],
      },
      "2026-10-29",
    ).rows.length,
    0,
  );
});
test("Missing recipes are reported rather than treated as zero demand", () => {
  assert.deepEqual(
    procurementPlan([order], { ...ops, recipes: [] }, "2026-10-29").missing,
    ["p"],
  );
});
