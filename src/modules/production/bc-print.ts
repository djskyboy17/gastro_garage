import type { BcContent } from "./domain.ts";

/**
 * Bon de consum nyomtatási képe (v73) – román nyelvű, önálló HTML a pillanatképből (Ctrl+P / PDF-be mentés).
 */
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const lei = (bani: number) => (bani / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function unitView(unit: string, quantity: number) {
  if (unit === "g") return { unit: "kg", quantity: quantity / 1000 };
  if (unit === "ml") return { unit: "l", quantity: quantity / 1000 };
  return { unit: "buc", quantity };
}
const qty = (v: number) => v.toLocaleString("ro-RO", { maximumFractionDigits: 3 });
const roDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : iso);

export function renderBcHtml(c: BcContent, numberText: string, options: { reversalOf?: string; issueDate?: string } = {}) {
  const rows = c.lines
    .map((l, i) => {
      const plan = unitView(l.unit, l.planned),
        used = unitView(l.unit, l.quantity);
      const lots = l.lots.map((x) => `${esc(x.batch)} (${esc(roDate(x.expires))}): ${qty(unitView(l.unit, x.quantity).quantity)}`).join("<br>");
      return `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td>${used.unit}</td><td class="n">${qty(plan.quantity)}</td><td class="n">${qty(used.quantity)}</td><td class="n">${lei(l.value)}</td><td><small>${lots}</small></td></tr>`;
    })
    .join("");
  const reversal = options.reversalOf ? `<p class="storno">STORNO la ${esc(options.reversalOf)}${c.reason ? " – motiv: " + esc(c.reason) : ""}</p>` : "";
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${esc(numberText)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
h1{font-size:18px;margin:0 0 4px}header{display:flex;justify-content:space-between;gap:16px;margin-bottom:14px}
.meta p{margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #444;padding:4px 5px;vertical-align:top}
th{background:#eee;font-size:11px}td small{color:#555;font-size:10px}.n{text-align:right;white-space:nowrap}
tfoot td{font-weight:bold}.storno{color:#a00;font-weight:bold}.sigs{display:flex;gap:24px;margin-top:28px;flex-wrap:wrap}
.sig{min-width:180px;border-top:1px solid #444;padding-top:4px}.sig small{display:block;color:#555}
@media print{body{margin:10mm}}
</style></head><body>
<header><div><h1>BON DE CONSUM</h1><p><b>Nr. ${esc(numberText)}</b> din ${esc(roDate(options.issueDate ?? c.batch.day))}</p>${reversal}</div>
<div class="meta"><p>Produs: <b>${esc(c.product.ro)}</b></p><p>Lot producție: <b>${esc(c.batch.code)}</b> · data producției ${esc(roDate(c.batch.day))}</p>
<p>Porții realizate: ${c.portions.actual}${c.portions.issuedBefore ? ` (din care ${c.portions.issuedBefore} consumate anterior pe comandă)` : ""} · porții consumate: ${c.portions.consumed}</p>
${c.dailyBatches ? `<p>Producție: ${c.dailyBatches.map(b=>esc(b.product.ro)+" × "+b.actual+" ("+esc(b.code)+")").join("; ")}</p>` : `<p>Rețetă: versiunea ${c.recipe.version}</p>`}${c.note ? `<p>Observații: ${esc(c.note)}</p>` : ""}</div></header>
<table><thead><tr><th>Nr.</th><th>Materie primă</th><th>U.M.</th><th>Cant. rețetă</th><th>Cant. consumată</th><th>Valoare (lei)</th><th>Lot (expiră): cantitate</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="5">Total</td><td class="n">${lei(c.totalValue)}</td><td></td></tr></tfoot></table>
<div class="sigs"><div class="sig"><span>&nbsp;</span><small>Predat (gestionar)</small></div><div class="sig"><span>&nbsp;</span><small>Primit (bucătărie)</small></div></div>
</body></html>`;
}

/** Selejt napi proces-verbalja (v74) – román nyomtatási kép a pillanatképből. */
export function renderWriteOffHtml(c: import("./finished.ts").WriteOffContent, numberText: string, options: { reversalOf?: string; issueDate?: string } = {}) {
  const rows = c.lines
    .map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.ro)}</td><td>${esc(l.code)}<small> (${esc(roDate(l.batchDay))})</small></td><td>porții</td><td class="n">${l.quantity}</td><td>${esc(l.reason)}</td><td class="n">${lei(l.value)}</td></tr>`)
    .join("");
  const reversal = options.reversalOf ? `<p class="storno">STORNO la ${esc(options.reversalOf)}${c.reason ? " – motiv: " + esc(c.reason) : ""}</p>` : "";
  const sigs = (c.committee.length ? c.committee : ["", ""]).map((n) => `<div class="sig"><span>${esc(n) || "&nbsp;"}</span><small>Semnătura</small></div>`).join("");
  return page(numberText, `<header><div><h1>PROCES-VERBAL DE CASARE</h1><p><b>Nr. ${esc(numberText)}</b> din ${esc(roDate(options.issueDate ?? c.day))}</p>${reversal}</div>
<div class="meta"><p>Produse finite (preparate culinare) scoase din gestiune în ziua ${esc(roDate(c.day))}.</p></div></header>
<table><thead><tr><th>Nr.</th><th>Produs</th><th>Lot</th><th>U.M.</th><th>Cantitate</th><th>Motiv</th><th>Valoare (lei)</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="6">Total</td><td class="n">${lei(c.totalValue)}</td></tr></tfoot></table>
<p>Comisia:</p><div class="sigs">${sigs}</div>`);
}

/** Bon de predare (v74) – a kész étel átadása a készletbe. */
export function renderHandoverHtml(c: import("./finished.ts").HandoverContent, numberText: string, options: { reversalOf?: string; issueDate?: string } = {}) {
  const reversal = options.reversalOf ? `<p class="storno">STORNO la ${esc(options.reversalOf)}${c.reason ? " – motiv: " + esc(c.reason) : ""}</p>` : "";
  return page(numberText, `<header><div><h1>BON DE PREDARE</h1><p><b>Nr. ${esc(numberText)}</b> din ${esc(roDate(options.issueDate ?? c.batch.day))}</p>${reversal}</div></header>
<table><thead><tr><th>Produs</th><th>Lot</th><th>Data producției</th><th>A se consuma până la</th><th>U.M.</th><th>Cantitate</th><th>Valoare (lei)</th></tr></thead>
<tbody><tr><td>${esc(c.product.ro)}</td><td>${esc(c.batch.code)}</td><td>${esc(roDate(c.batch.day))}</td><td>${c.useBy ? esc(roDate(c.useBy)) : "—"}</td><td>porții</td><td class="n">${c.portions}</td><td class="n">${lei(c.value)}</td></tr></tbody></table>
<div class="sigs"><div class="sig"><span>&nbsp;</span><small>Predat (bucătărie)</small></div><div class="sig"><span>&nbsp;</span><small>Primit (gestiune)</small></div></div>`);
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
h1{font-size:18px;margin:0 0 4px}header{display:flex;justify-content:space-between;gap:16px;margin-bottom:14px}
.meta p{margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #444;padding:4px 5px;vertical-align:top}
th{background:#eee;font-size:11px}td small{color:#555;font-size:10px}.n{text-align:right;white-space:nowrap}
tfoot td{font-weight:bold}.storno{color:#a00;font-weight:bold}.sigs{display:flex;gap:24px;margin-top:28px;flex-wrap:wrap}
.sig{min-width:180px;border-top:1px solid #444;padding-top:4px}.sig small{display:block;color:#555}
@media print{body{margin:10mm}}
</style></head><body>
${body}
</body></html>`;
}
