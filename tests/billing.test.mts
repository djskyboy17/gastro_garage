import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { profileError, vatOf, buildSnapshot, oblioInvoicePayload, monthRange, spvState, invoiceOpen, collectTypeFor, defaultBillingSettings, type BillingProfile } from "../src/modules/billing/domain.ts";

const company: BillingProfile = {
  customerId: "c1",
  kind: "company",
  mode: "monthly",
  name: "Panorama Office SRL",
  cif: "RO 18547290",
  regCom: "J14/123/2020",
  address: "Str. Fő 1",
  city: "Kézdivásárhely",
  county: "Covasna",
  country: "România",
  email: "",
  paymentDays: 15,
  revision: 1,
};
const order = (id: string, date: string, items: [string, number, number][], fee = 0) => ({ id, code: id.toUpperCase(), date, deliveryFee: fee, items: items.map(([ro, price, quantity]) => ({ ro, price, quantity })) });

test("Example 7: incomplete company data cannot be invoiced; a person needs only a name", () => {
  assert.equal(profileError(company), null);
  assert.equal(profileError({ ...company, cif: "" }), "BILLING_CIF_INVALID");
  assert.equal(profileError({ ...company, cif: "RO18547291" }), "BILLING_CIF_INVALID");
  assert.equal(profileError({ ...company, county: "" }), "BILLING_ADDRESS_REQUIRED");
  assert.equal(profileError({ ...company, name: " " }), "BILLING_NAME_REQUIRED");
  assert.equal(profileError({ ...company, kind: "person", cif: "", address: "", city: "", county: "" }), null);
});

test("VAT is taken out of gross prices, per rate", () => {
  assert.equal(vatOf(11100, 1100), 1100);
  assert.equal(vatOf(12100, 2100), 2100);
  assert.equal(vatOf(1000, 0), 0);
});

test("Example 3: a monthly invoice merges three orders, keeps delivery fees separate, lists order and aviz numbers", () => {
  const s = buildSnapshot({
    kind: "monthly",
    period: "2026-11",
    issueDate: "2026-11-30",
    profile: company,
    orders: [order("a1", "2026-11-03", [["Supă gulaș", 1400, 2], ["Meniul zilei", 2800, 1]], 1000), order("a2", "2026-11-10", [["Supă gulaș", 1400, 3]], 1000), order("a3", "2026-11-20", [["Supă gulaș", 1500, 1]])],
    notes: ["AVZ-2026-0001", "AVZ-2026-0007", "AVZ-2026-0012"],
    settings: { vatFoodBps: 1100, vatDeliveryBps: 2100 },
  });
  assert.deepEqual(
    s.lines.map((l: { name: string; unitPrice: number; quantity: number; total: number }) => [l.name, l.unitPrice, l.quantity, l.total]),
    [["Supă gulaș", 1400, 5, 7000], ["Meniul zilei", 2800, 1, 2800], ["Taxă livrare", 1000, 2, 2000], ["Supă gulaș", 1500, 1, 1500]],
  );
  assert.equal(s.total, 13300);
  assert.deepEqual(s.vat, [
    { bps: 2100, vat: vatOf(2000, 2100), base: 2000 - vatOf(2000, 2100) },
    { bps: 1100, vat: vatOf(11300, 1100), base: 11300 - vatOf(11300, 1100) },
  ]);
  assert.equal(s.dueDate, "2026-12-15");
  assert.equal(s.buyer.cif, "RO18547290");
  assert.match(s.mentions, /Perioada: 2026-11 · Comenzi: #A1, #A2, #A3 · Avize: AVZ-2026-0001, AVZ-2026-0007, AVZ-2026-0012/);
  const p = oblioInvoicePayload(s, { companyCif: "RO1234", seriesName: "GG", autoSpv: 1 }, "key-1", "2026-11/c1");
  assert.equal(p.idempotencyKey, "key-1");
  assert.equal(p.useStock, 0);
  assert.equal(p.client.vatPayer, 1);
  assert.deepEqual(p.products[0], { name: "Supă gulaș", price: 14, measuringUnit: "buc", vatPercentage: 11, vatIncluded: 1, quantity: 5, productType: "Serviciu" });
  assert.equal(p.products[2]!.vatPercentage, 21);
});

test("Month range, SPV state, open balance, collect types", () => {
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.throws(() => monthRange("2026-13"), /BILLING_PERIOD/);
  assert.equal(spvState(1), "accepted");
  assert.equal(spvState(0), "processing");
  assert.equal(spvState(2), "error");
  assert.equal(spvState(null), "none");
  assert.deepEqual(invoiceOpen(13300, 3000, 10300), { paid: 13300, open: 0 }, "example 4: on-site payment + bank transfer settle it");
  assert.deepEqual(invoiceOpen(13300, 3000, 0), { paid: 3000, open: 10300 });
  assert.equal(collectTypeFor("card", defaultBillingSettings), "Card");
  assert.equal(collectTypeFor("bank", defaultBillingSettings), "Ordin de plata");
  assert.equal(collectTypeFor("cash", { cashCollectType: "Chitanta" }), "Chitanta");
});
