/**
 * Aviz de însoțire a mărfii (v75) – tiszta függvények: kell-e aviz, tartalom, sztornó, román nyomtatási kép.
 * Ár nélkül: tételek, mennyiség, gyártási tétel. A szállító a címkeadatokból, a vevő a rendelés pillanatképéből.
 */

export type DeliveryNoteLine = {
  productId: string;
  name: string;
  quantity: number;
  allergens: string[];
  lot: string;
  productionDate: string;
  useBy: string | null;
};
export type DeliveryNoteContent = {
  supplier: { name: string; address: string; extra: string };
  buyer: { name: string; address: string; phone: string };
  order: { id: string; code: string; date: string; time: string; mode: "delivery" | "pickup" };
  lines: DeliveryNoteLine[];
  reason?: string;
};
export type DeliveryNoteRef = { id: string; number: string; kind: "issue" | "reversal"; status: "issued" | "reversed"; orderId: string; issueDate: string };

/** Kell-e aviz: az iroda kérte, vagy a beállítás szerint minden kiszállításhoz kell (átvételes rendelés csak kérésre). */
export function noteRequired(order: { deliveryNoteRequired?: number | null; fulfillmentMode?: string | null; monthlyBilling?: number | null }, allDeliveries: boolean) {
  const delivery = (order.fulfillmentMode ?? "delivery") !== "pickup";
  // v77: havi gyűjtőszámlás ügyfélnél minden kiszállításhoz aviz kell (a számla a hónap végén ezekre hivatkozik).
  return !!order.deliveryNoteRequired || ((allDeliveries || !!order.monthlyBilling) && delivery);
}

/** Kiállítható-e: visszaigazolt, még nem kézbesített rendelés. */
export function noteIssuable(order: { status: string; delivery: string }) {
  return order.status === "confirmed" && order.delivery !== "delivered";
}

/** A címkékből (gyártási tétel szerint bontva) aviz-sorok: ételenként és tételenként egy sor. */
export function noteLines(labels: { productId: string; name: { ro: string }; copies: number; allergens: string[]; lot: string; productionDate: string; useBy: string | null }[]): DeliveryNoteLine[] {
  return labels.map((l) => ({ productId: l.productId, name: l.name.ro, quantity: l.copies, allergens: l.allergens, lot: l.lot, productionDate: l.productionDate, useBy: l.useBy }));
}

export function reversalNote(c: DeliveryNoteContent, reason: string): DeliveryNoteContent {
  return { ...c, reason, lines: c.lines.map((l) => ({ ...l, quantity: -l.quantity })) };
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const roDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : iso);
const allergenRo: Record<string, string> = {
  gluten: "gluten",
  crustaceans: "crustacee",
  egg: "ouă",
  fish: "pește",
  peanut: "arahide",
  soy: "soia",
  milk: "lapte",
  nuts: "fructe cu coajă",
  celery: "țelină",
  mustard: "muștar",
  sesame: "susan",
  sulphites: "sulfiți",
  lupin: "lupin",
  molluscs: "moluște",
};

/** Egy aviz oldala (több aviz egy dokumentumban: oldaltöréssel). */
export function noteSection(c: DeliveryNoteContent, numberText: string, issueDate: string, reversalOf?: string) {
  const rows = c.lines
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.allergens.length ? `<small>Alergeni: ${esc(l.allergens.map((a) => allergenRo[a] ?? a).join(", "))}</small>` : ""}</td><td>porții</td><td class="n">${l.quantity}</td><td>${esc(l.lot)}<small>prod. ${esc(roDate(l.productionDate))}${l.useBy ? " · exp. " + esc(roDate(l.useBy)) : ""}</small></td></tr>`,
    )
    .join("");
  const storno = reversalOf ? `<p class="storno">STORNO la ${esc(reversalOf)}${c.reason ? " – motiv: " + esc(c.reason) : ""}</p>` : "";
  return `<section class="note"><header><div><h1>AVIZ DE ÎNSOȚIRE A MĂRFII</h1><p><b>Nr. ${esc(numberText)}</b> din ${esc(roDate(issueDate))}</p>${storno}</div>
<div class="meta"><p>Comandă: #${esc(c.order.code)} · livrare ${esc(roDate(c.order.date))} ${esc(c.order.time)}${c.order.mode === "pickup" ? " (ridicare personală)" : ""}</p></div></header>
<div class="parties"><div><small>Furnizor</small><b>${esc(c.supplier.name) || "—"}</b><span>${esc(c.supplier.address)}</span><span>${esc(c.supplier.extra)}</span></div>
<div><small>Cumpărător</small><b>${esc(c.buyer.name)}</b><span>${esc(c.buyer.address)}</span><span>${esc(c.buyer.phone)}</span></div></div>
<table><thead><tr><th>Nr.</th><th>Denumire</th><th>U.M.</th><th>Cantitate</th><th>Lot</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">Total porții</td><td class="n">${c.lines.reduce((s, l) => s + l.quantity, 0)}</td><td></td></tr></tfoot></table>
<div class="sigs"><div class="sig"><span>&nbsp;</span><small>Semnătura expeditor</small></div><div class="sig"><span>&nbsp;</span><small>Delegat / transportator</small></div><div class="sig"><span>&nbsp;</span><small>Semnătura primitor</small></div></div></section>`;
}

export function renderNotesHtml(title: string, sections: string[]) {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
.note+.note{page-break-before:always;margin-top:32px}
h1{font-size:18px;margin:0 0 4px}header{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px}
.meta p{margin:2px 0}.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px}
.parties div{border:1px solid #444;padding:6px 8px;display:grid;gap:2px}.parties small{color:#555}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #444;padding:4px 5px;vertical-align:top}
th{background:#eee;font-size:11px}td small{display:block;color:#555;font-size:10px}.n{text-align:right;white-space:nowrap}
tfoot td{font-weight:bold}.storno{color:#a00;font-weight:bold}.sigs{display:flex;gap:24px;margin-top:28px;flex-wrap:wrap}
.sig{min-width:160px;border-top:1px solid #444;padding-top:4px}.sig small{display:block;color:#555}
@media print{body{margin:10mm}}
</style></head><body>
${sections.join("\n")}
</body></html>`;
}
