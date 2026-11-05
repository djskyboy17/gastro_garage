import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { noteRequired, companyProfileError, noteIssuable, noteLines, reversalNote, noteSection, renderNotesHtml, type DeliveryNoteContent } from "../src/modules/delivery-notes/domain.ts";
// @ts-ignore Node native type stripping
import { formatDocumentNumber, DOCUMENT_TYPES } from "../src/modules/documents/domain.ts";

const content: DeliveryNoteContent = {
  supplier: { name: "Gastro Garage", address: "Kézdivásárhely, Str. Fő 1", extra: "ANSVSA 123" },
  buyer: { name: "Kiss Anna", address: "Bereck, Str. Mare 2", phone: "0740 000 000" },
  order: { id: "o1", code: "AB12", date: "2026-11-04", time: "12:00", mode: "delivery" },
  lines: noteLines([
    { productId: "goulash", name: { ro: "Supă gulaș" }, copies: 3, allergens: ["celery", "gluten"], lot: "L261103-ABCD", productionDate: "2026-11-03", useBy: "2026-11-05" },
    { productId: "goulash", name: { ro: "Supă gulaș" }, copies: 2, allergens: ["celery", "gluten"], lot: "L261104-ABCD", productionDate: "2026-11-04", useBy: "2026-11-06" },
  ]),
};

test("Example 1: who needs an aviz – office flag, or every delivery when the setting is on", () => {
  assert.equal(noteRequired({ deliveryNoteRequired: 0, fulfillmentMode: "delivery" }, false), false);
  assert.equal(noteRequired({ deliveryNoteRequired: 1, fulfillmentMode: "delivery" }, false), true);
  assert.equal(noteRequired({ deliveryNoteRequired: 0, fulfillmentMode: "delivery" }, true), true);
  assert.equal(noteRequired({ deliveryNoteRequired: 0, fulfillmentMode: "pickup" }, true), false, "pickup only on request");
  assert.equal(noteRequired({ deliveryNoteRequired: 1, fulfillmentMode: "pickup" }, true), true);
  assert.equal(noteIssuable({ status: "confirmed", delivery: "pending" }), true);
  assert.equal(noteIssuable({ status: "confirmed", delivery: "transit" }), true);
  assert.equal(noteIssuable({ status: "confirmed", delivery: "delivered" }), false);
  assert.equal(noteIssuable({ status: "requested", delivery: "pending" }), false);
  assert.equal(formatDocumentNumber(DOCUMENT_TYPES.delivery_note, 2026, 1), "AVZ-2026-0001");
});

test("Example 2: lines follow the production batches, like the labels (older batch first)", () => {
  assert.deepEqual(
    content.lines.map((l: { lot: string; quantity: number }) => [l.lot, l.quantity]),
    [["L261103-ABCD", 3], ["L261104-ABCD", 2]],
  );
});

test("Example 3: reversal negates quantities and prints STORNO with the reason", () => {
  const r = reversalNote(content, "comandă anulată");
  assert.deepEqual(r.lines.map((l: { quantity: number }) => l.quantity), [-3, -2]);
  assert.match(noteSection(r, "AVZ-2026-0002", "2026-11-04", "AVZ-2026-0001"), /STORNO la AVZ-2026-0001 – motiv: comandă anulată/);
});

test("Example 5: Romanian print without prices, with supplier, buyer, lot and allergens; several notes on separate pages", () => {
  const one = noteSection(content, "AVZ-2026-0001", "2026-11-04");
  assert.match(one, /AVIZ DE ÎNSOȚIRE A MĂRFII/);
  assert.match(one, /AVZ-2026-0001/);
  assert.match(one, /Gastro Garage/);
  assert.match(one, /Kiss Anna/);
  assert.match(one, /L261103-ABCD/);
  assert.match(one, /Alergeni: țelină, gluten/);
  assert.match(one, /Total porții<\/td><td class="n">5/);
  assert.doesNotMatch(one, /lei|Preț|Valoare/i);
  const html = renderNotesHtml("Avize", [one, noteSection(content, "AVZ-2026-0002", "2026-11-04")]);
  assert.match(html, /\.note\+\.note\{page-break-before:always/);
  assert.equal(html.match(/<section class="note">/g)!.length, 2);
  assert.doesNotMatch(noteSection({ ...content, buyer: { ...content.buyer, name: "<script>x</script>" } }, "N", "2026-11-04"), /<script>x/);
});

test("v84: aviz is required for company deliveries only; a company pickup only on request", () => {
  assert.equal(noteRequired({ deliveryNoteRequired: 0, fulfillmentMode: "delivery", companyBilling: 1 }, false), true);
  assert.equal(noteRequired({ deliveryNoteRequired: 0, fulfillmentMode: "delivery", companyBilling: 0 }, false), false);
  assert.equal(noteRequired({ deliveryNoteRequired: 0, fulfillmentMode: "pickup", companyBilling: 1 }, false), false);
  assert.equal(companyProfileError({ name: "GASTRO GARAGE S.R.L.", cui: "52188013", regCom: "J2025053505001", address: "Sat Lunga nr. 330" }), null);
  assert.equal(companyProfileError({ name: "GASTRO GARAGE S.R.L.", cui: "", regCom: "J2025053505001", address: "x" }), "COMPANY_PROFILE_REQUIRED");
});

test("v84: the aviz shows supplier and buyer identifiers, transport lines and the legal footer instead of signatures", () => {
  const c: DeliveryNoteContent = {
    ...content,
    supplier: { name: "GASTRO GARAGE S.R.L.", address: "Sat Lunga nr. 330, jud. Covasna", extra: "", cui: "52188013", regCom: "J2025053505001", workPoint: "" },
    buyer: { name: "Firma SRL", address: "Str. Livrare 5", phone: "07", cif: "RO18547290", regCom: "J14/1/2020", seat: "Str. Sediu 1, Sfântu Gheorghe, jud. Covasna" },
    footer: "Document generat electronic, valabil fără semnătură și ștampilă.",
  };
  const html = noteSection(c, "AVZ-2026-0001", "2026-11-05", undefined, "note-id-1");
  assert.ok(html.includes("CUI / CIF: 52188013"));
  assert.ok(html.includes("Reg. Com.: J2025053505001"));
  assert.ok(html.includes("CUI / CIF: RO18547290"));
  assert.ok(html.includes("Adresă de livrare: Str. Livrare 5"));
  assert.match(html, /Mijloc de transport/);
  assert.match(html, /valabil fără semnătură/);
  assert.match(html, /ID audit sistem: note-id-1/);
  assert.doesNotMatch(html, /Semnătura expeditor/);
  assert.match(noteSection(content, "AVZ-2026-0002", "2026-11-05"), /Semnătura expeditor/, "without a footer the signature lines stay");
});
