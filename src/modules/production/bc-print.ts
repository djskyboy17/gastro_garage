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

/**
 * Bon de consum (v92, a könyvelő mintája szerint): Unitatea, Gestiunea predatoare, Nr. doc., Data, Nr. comandă / Cod produs;
 * tételek: Nr. crt., Denumire, U.M., Cantitate necesară, Cantitate eliberată, Preț unitar, Valoare; Total; Gestionar / Primitor
 * aláírással. Gestionar és primitor ugyanaz a személy (aki a napot lezárta), elektronikus aláírással.
 */
export function renderBcHtml(c: BcContent, numberText: string, options: { reversalOf?: string; issueDate?: string; company?: string } = {}) {
  const rows = c.lines
    .map((l, i) => {
      const plan = unitView(l.unit, l.planned),
        used = unitView(l.unit, l.quantity);
      const unitPrice = used.quantity ? l.value / used.quantity : 0;
      return `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="c">${used.unit}</td><td class="n">${qty(plan.quantity)}</td><td class="n">${qty(used.quantity)}</td><td class="n">${lei(Math.round(unitPrice))}</td><td class="n">${lei(l.value)}</td></tr>`;
    })
    .join("");
  const reversal = options.reversalOf ? `<p class="storno">STORNO la ${esc(options.reversalOf)}${c.reason ? " – motiv: " + esc(c.reason) : ""}</p>` : "";
  const date = roDate(options.issueDate ?? c.batch.day).replace(/\./g, "/");
  const signed = c.signer?.name ? `<b>${esc(c.signer.name)}</b>` : "";
  const mark = c.signer?.name ? `Semnat electronic<br><small>${esc(new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }).format(new Date(c.signer.at)))}</small>` : "";
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${esc(numberText)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
h1{font-size:17px;text-align:center;margin:0 0 14px}.head{display:flex;justify-content:space-between;gap:24px;margin-bottom:10px}
.head p{margin:3px 0}.head span{display:inline-block;min-width:150px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:3px 5px;vertical-align:top}
th{font-size:11px;font-weight:bold}.idx td{text-align:center;font-size:10px;padding:1px}.n{text-align:right;white-space:nowrap}.c{text-align:center}
.total td{border:0;text-align:right;font-weight:bold;padding-top:6px}.storno{color:#a00;font-weight:bold}
.sign{margin-top:18px}.sign th{text-align:left}.sign td{height:42px}
@media print{body{margin:10mm}}
</style></head><body>
<h1>BON DE CONSUM</h1>${reversal}
<div class="head"><div><p><span>Unitatea:</span><b>${esc(options.company ?? "")}</b></p><p><span>Gestiunea predatoare:</span>Bucătărie</p></div>
<div><p><span>Nr. doc.:</span><b>${esc(numberText)}</b></p><p><span>Data:</span>${esc(date)}</p><p><span>Nr. comandă / Cod produs:</span>${esc(c.batch.code)}</p></div></div>
<table><thead><tr><th>Nr.<br>crt.</th><th>Denumirea materialelor</th><th>U.M.</th><th>Cantitate<br>necesară</th><th>Cantitate<br>eliberată</th><th>Preț unitar (RON)</th><th>Valoare (RON)</th></tr>
<tr class="idx"><td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td></tr></thead>
<tbody>${rows}</tbody><tfoot><tr class="total"><td colspan="7">Total: ${lei(c.totalValue)}</td></tr></tfoot></table>
<table class="sign"><tr><th>Gestionar</th><th>Semnătura</th><th>Primitor</th><th>Semnătura</th></tr><tr><td>${signed}</td><td>${mark}</td><td>${signed}</td><td>${mark}</td></tr></table>
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
