import { test } from "node:test";
import assert from "node:assert/strict";
import {
  purchasePhase,
  purchaseTransition,
  inboundSupply,
  purchaseValue,
  type PurchaseOrder,
} from "../src/modules/purchasing/domain.ts";
import {
  procurementPlan,
  emptyOperations,
  type OperationsData,
} from "../src/modules/inventory/domain.ts";
const p: PurchaseOrder = {
  id: "po",
  supplierId: "s",
  supplierName: "Supplier",
  supplierTaxId: "",
  supplierAddress: "",
  due: "2026-10-29",
  note: "",
  status: "draft",
  revision: 0,
  createdAt: "",
  lines: [
    {
      id: "pl",
      purchaseId: "po",
      ingredientId: "i",
      hu: "Alapanyag",
      ro: "Ingredient",
      unit: "g",
      quantity: 1000,
      received: 0,
      packQuantity: 1000,
      packPrice: 1500,
    },
  ],
};
test("Purchase states distinguish draft, ordered, partial and complete", () => {
  assert.equal(purchasePhase(p), "draft");
  assert.equal(purchaseTransition(p, "confirm"), "ordered");
  assert.equal(purchasePhase({ ...p, status: "ordered" }), "ordered");
  assert.equal(
    purchasePhase({
      ...p,
      status: "ordered",
      lines: p.lines.map((l) => ({ ...l, received: 400 })),
    }),
    "partial",
  );
  assert.equal(
    purchasePhase({
      ...p,
      status: "ordered",
      lines: p.lines.map((l) => ({ ...l, received: 1000 })),
    }),
    "received",
  );
});
test("Partial purchase may close remainder but cannot cancel received goods", () => {
  const part = {
    ...p,
    status: "ordered",
    lines: p.lines.map((l) => ({ ...l, received: 400 })),
  };
  assert.equal(purchaseTransition(part, "close"), "closed");
  assert.throws(
    () => purchaseTransition(part, "cancel"),
    /PURCHASE_TRANSITION/,
  );
  assert.throws(() =>
    purchaseTransition({ ...p, status: "closed" }, "confirm"),
  );
});
test("Inbound supply counts only outstanding confirmed quantities due by planning day", () => {
  const part = {
    ...p,
    status: "ordered",
    lines: p.lines.map((l) => ({ ...l, received: 400 })),
  };
  const data = {
    suppliers: [],
    events: [],
    orders: [
      p,
      part,
      { ...part, id: "closed", status: "closed" },
      { ...part, id: "future", due: "2026-11-01" },
    ],
  };
  assert.deepEqual(inboundSupply(data, "2026-10-29"), [
    { ingredientId: "i", quantity: 600 },
  ]);
  assert.equal(part.lines[0].received, 400);
});
test("Purchase valuation uses captured pack prices and integer bani", () => {
  assert.equal(purchaseValue(p.lines), 1500);
  assert.equal(
    purchaseValue(p.lines.map((l) => ({ ...l, quantity: 333 }))),
    500,
  );
});
test("Expected supply reduces procurement shortage but never becomes available stock", () => {
  const ops: OperationsData = {
    ...emptyOperations,
    ingredients: [
      {
        id: "i",
        hu: "A",
        ro: "A",
        unit: "g",
        packQuantity: 1000,
        packPrice: 1500,
        minStock: 1000,
        allergens: "",
        supplier: "",
      },
    ],
  };
  const plan = procurementPlan([], ops, "2026-10-29", true, [
    { ingredientId: "i", quantity: 600 },
  ]);
  assert.equal(plan.rows[0].shortage, 400);
  assert.equal(plan.rows[0].available, 0);
  assert.equal(plan.rows[0].incoming, 600);
});
