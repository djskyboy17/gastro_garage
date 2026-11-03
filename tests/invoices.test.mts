import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { parseMoney, parseQuantity, parseVatRate, parseInvoiceDate, normalizeTaxId, validTaxId, normalizeUnit, defaultFactor, baseQuantityOf, netOf, grossOf, costOf, totalsCheck, mappingKey, suggestIngredient, lineReceiveError, normalizeExtraction, detectInvoiceFile, type InvoiceLine } from "../src/modules/invoices/domain.ts";
// @ts-ignore Node native type stripping
import { extractWithGemini, geminiRequestBody } from "../src/modules/invoices/gemini.ts";

test("Romanian amounts, quantities, VAT rates and dates are parsed to integers", () => {
  assert.equal(parseMoney("1.234,56"), 123456);
  assert.equal(parseMoney("1,234.56"), 123456);
  assert.equal(parseMoney("12,5"), 1250);
  assert.equal(parseMoney("1234.56"), 123456);
  assert.equal(parseMoney("1.234.567"), 123456700);
  assert.equal(parseMoney("12,345 lei"), 1235);
  assert.equal(parseMoney("-3,00"), -300);
  assert.equal(parseMoney(12.5), 1250);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseQuantity("1,25"), 1250);
  assert.equal(parseQuantity("2"), 2000);
  assert.equal(parseVatRate("21%"), 2100);
  assert.equal(parseVatRate("9"), 900);
  assert.equal(parseVatRate("0.11"), 1100);
  assert.equal(parseVatRate(0.21), 2100);
  assert.equal(parseVatRate(""), null);
  assert.equal(parseInvoiceDate("03.11.2026"), "2026-11-03");
  assert.equal(parseInvoiceDate("3/11/26"), "2026-11-03");
  assert.equal(parseInvoiceDate("2026-11-03"), "2026-11-03");
  assert.equal(parseInvoiceDate("31.02.2026"), "");
});

test("CUI is normalized and its control digit checked; units and stock quantities convert", () => {
  assert.equal(normalizeTaxId("RO 18 547 290"), "RO18547290");
  assert.equal(normalizeTaxId("CUI: 18547290"), "18547290");
  assert.equal(validTaxId("RO18547290"), true);
  assert.equal(validTaxId("18547291"), false);
  assert.equal(normalizeUnit("KG"), "kg");
  assert.equal(normalizeUnit("Buc."), "buc");
  assert.equal(normalizeUnit("ltr"), "l");
  assert.equal(defaultFactor("kg", { unit: "g" }), 1000);
  assert.equal(defaultFactor("l", { unit: "ml" }), 1000);
  assert.equal(defaultFactor("buc", { unit: "pcs" }), 1);
  assert.equal(defaultFactor("buc", { unit: "g" }), null);
  assert.equal(baseQuantityOf(1250, 1000), 1250);
  assert.equal(baseQuantityOf(3000, 1), 3);
});

test("Stock value follows the cost basis; SGR deposits and totals are checked", () => {
  const line = { lineNet: 10000, lineGross: null, vatRate: 1100 };
  assert.equal(netOf(line), 10000);
  assert.equal(grossOf(line), 11100);
  assert.equal(costOf(line, "net"), 10000);
  assert.equal(costOf(line, "gross"), 11100);
  assert.equal(netOf({ lineNet: null, lineGross: 12100, vatRate: 2100 }), 10000);
  assert.equal(costOf({ lineNet: null, lineGross: 500, vatRate: null }, "net"), null);
  const lines = [{ lineNet: null, lineGross: 1210, vatRate: 2100 }, { lineNet: null, lineGross: 100, vatRate: 0 }];
  assert.equal(totalsCheck({ total: 1310, sgrTotal: 100 }, lines).ok, true);
  // SGR nem külön sorként: a végösszegben benne van.
  assert.equal(totalsCheck({ total: 1310, sgrTotal: 100 }, [lines[0]!]).ok, true);
  assert.equal(totalsCheck({ total: 2000, sgrTotal: 0 }, lines).ok, false);
});

test("Gemini output is normalized: seller, bani, ISO date, deposit lines skipped from stock by default", () => {
  const x = normalizeExtraction({
    document_type: "factura",
    supplier_name: " METRO Cash & Carry România SRL ",
    supplier_tax_id: "RO 1234567",
    series: "MCC",
    number: "000123",
    issue_date: "02.11.2026",
    subtotal: "1.000,00",
    vat_total: "110,00",
    sgr_total: null,
    total: "1.111,00",
    lines: [
      { description: "Piept de pui", quantity: "2,5", unit: "KG", line_net: "100,00", vat_rate: "11%", is_deposit: false },
      { description: "Apa plata 0,5L", quantity: "2", unit: "buc", unit_price: "2,00", vat_rate: "21", is_deposit: false },
      { description: "Garantie SGR", quantity: "2", unit: "buc", line_gross: "1,00", vat_rate: "0", is_deposit: false },
    ],
  });
  assert.equal(x.kind, "factura");
  assert.equal(x.supplierName, "METRO Cash & Carry România SRL");
  assert.equal(x.supplierTaxId, "RO1234567");
  assert.equal(x.number, "000123");
  assert.equal(x.issueDate, "2026-11-02");
  assert.equal(x.total, 111100);
  assert.equal(x.lines[0]!.invoiceQuantity, 2500);
  assert.equal(x.lines[0]!.invoiceUnit, "kg");
  assert.equal(x.lines[0]!.vatRate, 1100);
  assert.equal(x.lines[1]!.lineNet, 400);
  assert.equal(x.lines[2]!.deposit, 1);
  assert.equal(x.sgrTotal, 100);
  const bon = normalizeExtraction({ document_type: "bon_fiscal", lines: [{ description: "PAINE", quantity: "1", unit_price: "5,50", is_deposit: false }] });
  assert.equal(bon.kind, "bon_fiscal");
  assert.equal(bon.lines[0]!.lineGross, 550);
  assert.throws(() => normalizeExtraction("nem objektum"), /INVOICE_AI_INVALID/);
});

test("Ingredient suggestion prefers a remembered mapping, otherwise a clear name match", () => {
  const ingredients = [{ id: "chicken", hu: "Csirkemell", ro: "Piept de pui" }, { id: "potato", hu: "Burgonya", ro: "Cartofi" }, { id: "oil", hu: "Napraforgó olaj", ro: "Ulei floarea soarelui" }];
  const key = mappingKey("RO1234567", "Metro", "PIEPT PUI KG");
  assert.equal(key, mappingKey("1234567", "Other name", "piept  pui kg"));
  assert.deepEqual(suggestIngredient("PIEPT PUI KG", key, ingredients, [{ key, ingredientId: "chicken", factor: 1000 }]), { ingredientId: "chicken", factor: 1000, remembered: true });
  assert.equal(suggestIngredient("Cartofi albi", "x", ingredients, [])?.ingredientId, "potato");
  assert.equal(suggestIngredient("Pungă", "x", ingredients, []), null);
});

test("A line is receivable only with ingredient, quantity, expiry and a computable value", () => {
  const base: InvoiceLine = { id: "l", position: 1, description: "Pui", invoiceQuantity: 2000, invoiceUnit: "kg", lineNet: 5000, vatRate: 1100, lineGross: null, deposit: 0, skip: 0, ingredientId: "chicken", baseQuantity: 2000, expires: "2026-11-10", batch: "" };
  assert.equal(lineReceiveError(base, "2026-11-03", "net"), null);
  assert.equal(lineReceiveError({ ...base, ingredientId: null }, "2026-11-03", "net"), "INVOICE_LINE_INGREDIENT");
  assert.equal(lineReceiveError({ ...base, baseQuantity: 0 }, "2026-11-03", "net"), "INVOICE_LINE_QUANTITY");
  assert.equal(lineReceiveError({ ...base, expires: "2026-11-01" }, "2026-11-03", "net"), "INVOICE_LINE_EXPIRES");
  assert.equal(lineReceiveError({ ...base, lineNet: null, lineGross: 5550, vatRate: null }, "2026-11-03", "net"), "INVOICE_LINE_COST");
  assert.equal(lineReceiveError({ ...base, skip: 1, ingredientId: null }, "2026-11-03", "net"), null);
});

test("Invoice files are recognized by their bytes", () => {
  assert.equal(detectInvoiceFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectInvoiceFile(new TextEncoder().encode("%PDF-1.7\n")), "application/pdf");
  assert.equal(detectInvoiceFile(new TextEncoder().encode("<html>")), null);
});

test("Gemini adapter sends the file with a JSON schema and returns parsed JSON; failures map to error codes", async () => {
  const body = geminiRequestBody("image/jpeg", "AAAA");
  const filePart = body.contents[0]!.parts[1] as { inline_data: { mime_type: string } };
  assert.equal(filePart.inline_data.mime_type, "image/jpeg");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  let seen: { url: string; key: string | null } | null = null;
  const ok = (async (url: string, init: RequestInit) => {
    seen = { url, key: new Headers(init.headers).get("x-goog-api-key") };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"document_type":"bon_fiscal","lines":[]}' }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await extractWithGemini({ apiKey: "test-key", mime: "image/jpeg", base64: "AAAA", fetchImpl: ok }), { document_type: "bon_fiscal", lines: [] });
  assert.match(seen!.url, /gemini-2\.5-flash:generateContent$/);
  assert.equal(seen!.key, "test-key");
  const status = (code: number) => (async () => new Response("{}", { status: code })) as unknown as typeof fetch;
  await assert.rejects(extractWithGemini({ apiKey: "k", mime: "image/jpeg", base64: "AAAA", fetchImpl: status(429) }), /INVOICE_AI_BUSY/);
  await assert.rejects(extractWithGemini({ apiKey: "k", mime: "image/jpeg", base64: "AAAA", fetchImpl: status(403) }), /INVOICE_AI_REJECTED/);
  await assert.rejects(extractWithGemini({ apiKey: "", mime: "image/jpeg", base64: "AAAA", fetchImpl: ok }), /INVOICE_AI_DISABLED/);
  const garbage = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(extractWithGemini({ apiKey: "k", mime: "image/jpeg", base64: "AAAA", fetchImpl: garbage }), /INVOICE_AI_INVALID/);
});
