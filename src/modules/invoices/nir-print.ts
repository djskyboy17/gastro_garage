import type { NirContent } from "./domain.ts";

/**
 * NIR nyomtatási képe (v72) – román nyelvű, önálló HTML (a böngészőből Ctrl+P / PDF-be mentés).
 * Tiszta függvény: csak a pillanatképből dolgozik, így a kiállítás utáni törzsadat-változás nem hat rá.
 */
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const lei = (bani: number) => (bani / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Alapegység → nyomtatási egység: g → kg, ml → l, db → buc. */
function unitView(unit: string, quantity: number) {
  if (unit === "g") return { unit: "kg", quantity: quantity / 1000 };
  if (unit === "ml") return { unit: "l", quantity: quantity / 1000 };
  return { unit: "buc", quantity };
}
const qty = (v: number) => v.toLocaleString("ro-RO", { maximumFractionDigits: 3 });
const roDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : iso);

export function renderNirHtml(c: NirContent, numberText: string, options: { reversalOf?: string; company?: string } = {}) {
  const rows = c.lines
    .map((l, i) => {
      const inv = unitView(l.unit, l.invoiced),
        rec = unitView(l.unit, l.received);
      const unitPrice = rec.quantity ? l.value / rec.quantity : 0;
      return `<tr><td>${i + 1}</td><td>${esc(l.ingredientName)}<small>${esc(l.description)}</small></td><td>${rec.unit}</td><td class="n">${qty(inv.quantity)}</td><td class="n">${qty(rec.quantity)}</td><td class="n">${qty(rec.quantity - inv.quantity)}</td><td class="n">${lei(Math.round(unitPrice))}</td><td class="n">${lei(l.value)}</td><td class="n">${l.vatRate === null ? "—" : (l.vatRate / 100).toLocaleString("ro-RO") + "%"}</td><td class="n">${lei(l.vat)}</td><td>${esc(l.batch)}<small>${esc(roDate(l.expires))}</small></td></tr>`;
    })
    .join("");
  const reversal = options.reversalOf ? `<p class="storno">STORNO la ${esc(options.reversalOf)}${c.reason ? " – motiv: " + esc(c.reason) : ""}</p>` : "";
  const committee = (c.committee.length ? c.committee : ["", "", ""]).map((n) => `<div class="sig"><span>${esc(n) || "&nbsp;"}</span><small>Semnătura</small></div>`).join("");
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${esc(numberText)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
h1{font-size:18px;margin:0 0 4px}header{display:flex;justify-content:space-between;gap:16px;margin-bottom:14px}
.meta p{margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #444;padding:4px 5px;vertical-align:top}
th{background:#eee;font-size:11px}td small{display:block;color:#555;font-size:10px}.n{text-align:right;white-space:nowrap}
tfoot td{font-weight:bold}.storno{color:#a00;font-weight:bold}.committee{display:flex;gap:24px;margin-top:28px;flex-wrap:wrap}
.sig{min-width:180px;border-top:1px solid #444;padding-top:4px}.sig small{display:block;color:#555}
@media print{body{margin:10mm}}
</style></head><body>
<header><div><h1>NOTĂ DE INTRARE-RECEPȚIE</h1><p><b>Nr. ${esc(numberText)}</b> din ${esc(roDate(c.receivedDate))}</p>${reversal}</div>
<div class="meta">${options.company ? `<p><b>${esc(options.company)}</b></p>` : ""}<p>Furnizor: <b>${esc(c.supplier.name)}</b></p><p>CUI/CIF: ${esc(c.supplier.taxId)}</p>
<p>Document: ${c.invoice.kind === "bon_fiscal" ? "Bon fiscal" : "Factură"} ${esc((c.invoice.series + " " + c.invoice.number).trim())} din ${esc(roDate(c.invoice.date))}</p>
<p>Valoare document: ${c.invoice.total === null ? "—" : lei(c.invoice.total)} ${esc(c.invoice.currency)}</p><p>Evaluare: ${c.costBasis === "net" ? "fără TVA" : "cu TVA"}</p></div></header>
<table><thead><tr><th>Nr.</th><th>Denumire</th><th>U.M.</th><th>Cant. document</th><th>Cant. recepționată</th><th>Diferență</th><th>Preț unitar</th><th>Valoare</th><th>Cotă TVA</th><th>Valoare TVA</th><th>Lot / Expiră</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="7">Total</td><td class="n">${lei(c.totals.value)}</td><td></td><td class="n">${lei(c.totals.vat)}</td><td class="n">${lei(c.totals.gross)}</td></tr></tfoot></table>
<p>Comisia de recepție:</p><div class="committee">${committee}</div>
</body></html>`;
}
