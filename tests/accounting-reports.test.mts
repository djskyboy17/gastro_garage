import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node type stripping
import { weekRange, monthWeeks, accountingDeadline, summarizeConsumption, consumptionSection, reportPage, type BcReportDocument } from "../src/modules/accounting/report-domain.ts";

function document(id: string, day: string, sign = 1): BcReportDocument {
  return { id, number: id, issueDate: day, kind: sign === 1 ? "consumption" : "reversal", content: {
    batch: { id: "batch", code: "B1", day: "2026-10-31" }, product: { hu: "Teszt", ro: "Test" }, portions: { actual: 1, consumed: 1, issuedBefore: 0 },
    recipe: { id: "recipe", version: 1 }, note: "", totalValue: 121 * sign,
    lines: [{ ingredientId: "flour", name: "Făină <test>", unit: "g", planned: 100 * sign, quantity: 100 * sign, value: 121 * sign, lots: [] }],
  } };
}

test("Weekly intervals cross year boundaries without kitchen timezone shifts", () => {
  assert.deepEqual(weekRange("2026-11-01"), { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(weekRange("2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
  assert.throws(() => weekRange("2026-02-30"));
});

test("Monthly weekly summaries cover the selected month exactly once and deadline crosses years", () => {
  const weeks = monthWeeks("2026-11");
  assert.deepEqual(weeks[0], { from: "2026-11-01", to: "2026-11-01" });
  assert.deepEqual(weeks.at(-1), { from: "2026-11-30", to: "2026-11-30" });
  const days = weeks.reduce((count, week) => count + (Date.parse(week.to) - Date.parse(week.from)) / 86400000 + 1, 0);
  assert.equal(days, 30);
  assert.equal(accountingDeadline("2026-12"), "2027-01-10");
});

test("Reversed originals stay in their original period and signed corrections belong to their own period", () => {
  const original = document("BC1", "2026-10-31");
  const reversal = document("BC2", "2026-11-05", -1);
  assert.equal(summarizeConsumption([original]).total, 121);
  assert.equal(summarizeConsumption([reversal]).total, -121);
  assert.equal(summarizeConsumption([original, reversal]).total, 0);
  assert.equal(summarizeConsumption([original, original]).count, 1);
  assert.equal(summarizeConsumption([original, original]).lines[0].quantity, 100);
});

test("Printable summaries preserve integer bani and escape historic names", () => {
  const html = reportPage("Demo <title>", "Demo & Co", [consumptionSection("2026-10-26", "2026-11-01", [document("BC1", "2026-10-31")])]);
  assert.match(html, /1,21/);
  assert.match(html, /Făină &lt;test&gt;/);
  assert.match(html, /Demo &amp; Co/);
  assert.doesNotMatch(html, /<test>/);
});
