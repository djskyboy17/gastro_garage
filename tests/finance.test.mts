import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { orderBalance, paymentError, courierCash, handoverError, cashDay, zReconcile, supplierBalance, renderCashRegisterHtml, type CashEntry } from "../src/modules/finance/domain.ts";

const pay = (amount: number, extra: Record<string, unknown> = {}) => ({ amount, method: "cash", collectedBy: "courier", collectorId: "c1", handoverId: null, ...extra }) as never;

test("Example 1: 85 lei order – full, partial, overpay and legacy paid flag", () => {
  assert.deepEqual(orderBalance(8500, [pay(8500)]), { paid: 8500, due: 0, status: "paid" });
  assert.deepEqual(orderBalance(8500, [pay(5000)]), { paid: 5000, due: 3500, status: "partial" });
  assert.deepEqual(orderBalance(8500, []), { paid: 0, due: 8500, status: "unpaid" });
  assert.deepEqual(orderBalance(8500, [pay(8500), pay(-8500)]), { paid: 0, due: 8500, status: "unpaid" }, "example 6: reversal restores unpaid");
  assert.equal(orderBalance(8500, [], true).status, "paid");
  assert.equal(paymentError(3500, 3500), null);
  assert.equal(paymentError(3600, 3500), "PAYMENT_TOO_MUCH");
  assert.equal(paymentError(0, 3500), "PAYMENT_AMOUNT");
});

test("Example 2: courier holds 210 lei, hands over 200 – the difference needs a reason", () => {
  const ps = [pay(8500), pay(6500), pay(6000), pay(4000, { method: "card" }), pay(3000, { collectorId: "c2" }), pay(1000, { handoverId: "h0" })];
  const expected = courierCash(ps, "c1");
  assert.equal(expected, 21000);
  assert.equal(handoverError(expected, 20000, ""), "HANDOVER_NOTE_REQUIRED");
  assert.equal(handoverError(expected, 20000, "10 lei visszajáró hiányzik"), null);
  assert.equal(handoverError(expected, 21000, ""), null);
  assert.equal(handoverError(0, 0, ""), "HANDOVER_EMPTY");
});

test("Example 3: cash register day – opening 500, +200, +85, −120 → closing 665", () => {
  const t = cashDay([{ amount: 50000 }], [{ amount: 20000 }, { amount: 8500 }, { amount: -12000 }]);
  assert.deepEqual(t, { opening: 50000, income: 28500, expense: 12000, closing: 66500 });
  const next = cashDay([{ amount: 50000 }, { amount: 20000 }, { amount: 8500 }, { amount: -12000 }], []);
  assert.equal(next.opening, 66500);
  const entries: CashEntry[] = [
    { id: "1", day: "2026-11-04", kind: "courier_handover", amount: 20000, document: "PC-1", note: "Futár Feri", refId: null, reversalOf: null, createdAt: "" },
    { id: "2", day: "2026-11-04", kind: "supplier_payment", amount: -12000, document: "MCC 123", note: "", refId: null, reversalOf: null, createdAt: "" },
  ];
  const html = renderCashRegisterHtml("2026-11-04", "Gastro Garage SRL", entries, t, true);
  assert.match(html, /REGISTRU DE CASĂ/);
  assert.match(html, /Sold inițial[\s\S]*500,00/);
  assert.match(html, /Predare numerar curier/);
  assert.match(html, /Sold final<\/td><td class="n">665,00/);
  assert.match(renderCashRegisterHtml("2026-11-04", "", [], t, false), /ziua nu este închisă/);
  assert.doesNotMatch(renderCashRegisterHtml("2026-11-04", "<b>x", entries, t, true), /<b>x/);
});

test("Example 4: Z report cash 285, card 140 vs recorded cash 285, card 130 → 10 lei card difference", () => {
  const r = zReconcile({ cash: 28500, card: 14000, total: 42500 }, [{ method: "cash", amount: 28500 }, { method: "card", amount: 13000 }]);
  assert.deepEqual(r.system, { cash: 28500, card: 13000, total: 41500 });
  assert.deepEqual(r.diff, { cash: 0, card: 1000, total: 1000, zSplit: 0 });
  assert.equal(zReconcile(null, []).diff, null);
});

test("Example 5: supplier invoice 1000 lei, 400 cash + 600 bank → paid; overdue only while open", () => {
  assert.deepEqual(supplierBalance(100000, [{ amount: 40000 }, { amount: 60000 }], "2026-11-01", "2026-11-04"), { paid: 100000, open: 0, overdue: false });
  assert.deepEqual(supplierBalance(100000, [{ amount: 40000 }], "2026-11-01", "2026-11-04"), { paid: 40000, open: 60000, overdue: true });
  assert.equal(supplierBalance(100000, [], "", "2026-11-04").overdue, false);
});
