import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { planDayClose, remainingAt, portionValue, labelAllocation, usableFinished, reversalWriteOff, reversalHandover, type FinishedLot, type WriteOffContent } from "../src/modules/production/finished.ts";
// @ts-ignore Node native type stripping
import { renderWriteOffHtml, renderHandoverHtml } from "../src/modules/production/bc-print.ts";

const lot = (batchId: string, day: string, remaining: number, useBy: string | null = null, productId = "goulash"): FinishedLot => ({ batchId, productId, code: "L-" + batchId, day, useBy, remaining });
const soup = (sold: number) => [{ productId: "goulash", hu: "Gulyás", ro: "Gulaș", sold }];
const input = (o: Partial<{ staff: number; waste: number; donation: number; wasteNote: string }> = {}) => [{ productId: "goulash", staff: 0, waste: 0, donation: 0, wasteNote: "", ...o }];

test("Example 1: 100 produced, 80 sold, 5 waste, 15 left – the balance matches", () => {
  const { rows, errors } = planDayClose("2026-11-04", soup(80), [lot("b1", "2026-11-04", 100, "2026-11-06")], input({ waste: 5, wasteNote: "leesett" }));
  assert.deepEqual(errors, []);
  const r = rows[0]!;
  assert.equal(r.opening, 0);
  assert.equal(r.produced, 100);
  assert.equal(r.closing, 15);
  assert.equal(r.opening + r.produced, r.sold + r.staff + r.waste + r.donation + r.closing);
  assert.deepEqual(r.moves, [
    { batchId: "b1", kind: "sold", quantity: 80 },
    { batchId: "b1", kind: "waste", quantity: 5 },
  ]);
  assert.equal(portionValue(5, 320000, 100), 16000);
  assert.equal(portionValue(5, 0, 100), 0);
});

test("Example 2: next day the leftover is used first, and early orders get yesterday's lot on the label", () => {
  // 15 maradt tegnapról (b1, másnapig fogyasztható), ma 25 + ráhagyás főtt (b2).
  const lots = [lot("b1", "2026-11-04", remainingAt(100, [{ day: "2026-11-04", quantity: 85 }], "2026-11-05"), "2026-11-05"), lot("b2", "2026-11-05", 28, "2026-11-07")];
  assert.equal(lots[0]!.remaining, 15);
  const { rows, errors } = planDayClose("2026-11-05", soup(40), lots, input({ staff: 3 }));
  assert.deepEqual(errors, []);
  assert.equal(rows[0]!.opening, 15);
  assert.equal(rows[0]!.closing, 0);
  assert.deepEqual(rows[0]!.moves, [
    { batchId: "b1", kind: "sold", quantity: 15 },
    { batchId: "b2", kind: "sold", quantity: 25 },
    { batchId: "b2", kind: "staff", quantity: 3 },
  ]);
  const alloc = labelAllocation(
    [
      { itemId: "late", productId: "goulash", orderTime: "13:00", orderId: "o2", quantity: 30 },
      { itemId: "early", productId: "goulash", orderTime: "11:00", orderId: "o1", quantity: 10 },
    ],
    lots,
    "2026-11-05",
  );
  assert.deepEqual(alloc.get("early"), [{ batchId: "b1", quantity: 10 }]);
  assert.deepEqual(alloc.get("late"), [{ batchId: "b1", quantity: 5 }, { batchId: "b2", quantity: 25 }]);
});

test("Example 3: closing cannot go negative; an expiring leftover must be written off; waste needs a reason", () => {
  assert.deepEqual(planDayClose("2026-11-04", soup(80), [lot("b1", "2026-11-04", 70, "2026-11-06")], input()).errors, [{ productId: "goulash", code: "DAY_SHORTAGE" }]);
  assert.equal(planDayClose("2026-11-04", soup(80), [lot("b1", "2026-11-04", 70, "2026-11-06")], input()).rows[0]!.closing, -10);
  // Fogyaszthatóság nélkül csak a gyártás napján adható ki: ami marad, az selejt vagy dolgozói.
  assert.deepEqual(planDayClose("2026-11-04", soup(8), [lot("b1", "2026-11-04", 10)], input()).errors, [{ productId: "goulash", code: "DAY_EXPIRED_LEFTOVER" }]);
  assert.deepEqual(planDayClose("2026-11-04", soup(8), [lot("b1", "2026-11-04", 10)], input({ staff: 2 })).errors, []);
  assert.deepEqual(planDayClose("2026-11-04", soup(8), [lot("b1", "2026-11-04", 10)], input({ waste: 2 })).errors, [{ productId: "goulash", code: "DAY_WASTE_NOTE" }]);
  // Lejárt tétel nem is használható.
  assert.equal(usableFinished([lot("old", "2026-11-01", 5, "2026-11-03")], "2026-11-04").length, 0);
});

test("Example 4: write-off reversal negates quantities and value; the PV prints in Romanian", () => {
  const c: WriteOffContent = { day: "2026-11-04", committee: ["Kiss Anna"], lines: [{ productId: "goulash", ro: "Supă gulaș", hu: "Gulyás", code: "L261104-ABCD", batchDay: "2026-11-04", quantity: 5, reason: "leesett", value: 16000 }], totalValue: 16000 };
  const r = reversalWriteOff(c, "téves");
  assert.equal(r.lines[0]!.quantity, -5);
  assert.equal(r.totalValue, -16000);
  const html = renderWriteOffHtml(c, "PVC-2026-0001");
  assert.match(html, /PROCES-VERBAL DE CASARE/);
  assert.match(html, /PVC-2026-0001/);
  assert.match(html, /Kiss Anna/);
  assert.match(html, /160,00/);
  assert.match(renderWriteOffHtml(r, "PVC-2026-0002", { reversalOf: "PVC-2026-0001" }), /STORNO la PVC-2026-0001 – motiv: téves/);
  assert.doesNotMatch(renderWriteOffHtml({ ...c, lines: [{ ...c.lines[0]!, reason: "<b>x" }] }, "N"), /<b>x/);
});

test("Example 5: bon de predare content and reversal", () => {
  const c = { batch: { id: "b1", code: "L261104-ABCD", day: "2026-11-04" }, product: { ro: "Supă gulaș", hu: "Gulyás" }, portions: 100, useBy: "2026-11-06", value: 320000 };
  assert.match(renderHandoverHtml(c, "BP-2026-0001"), /BON DE PREDARE[\s\S]*BP-2026-0001[\s\S]*06\.11\.2026/);
  assert.equal(reversalHandover(c, "x").portions, -100);
});
