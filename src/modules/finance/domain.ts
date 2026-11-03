/**
 * Pénzügy és pénztár (v76) – tiszta függvények: rendelés egyenlege, futár készpénze, pénztáregyenleg, Z-egyeztetés,
 * beszállítói tartozás, román pénztárkönyv-nyomtatás. Minden összeg egész bani.
 */

export type PaymentMethod = "cash" | "card";
export type Payment = {
  id: string;
  orderId: string;
  day: string;
  method: PaymentMethod;
  amount: number;
  collectedBy: "courier" | "office";
  collectorId: string;
  collectorName: string;
  reversalOf: string | null;
  reversedBy: string | null;
  handoverId: string | null;
  createdAt: string;
  note: string;
};
export type PaymentStatus = "paid" | "partial" | "unpaid";

/**
 * A rendelés egyenlege a befizetésekből. A v76 előtt „fizetve” jelölt, befizetés nélküli rendelés fizetettnek számít
 * (a régi jelölés megmarad, nem kell utólag rögzíteni).
 */
export function orderBalance(total: number, payments: Pick<Payment, "amount">[], legacyPaid = false) {
  if (legacyPaid && payments.length === 0) return { paid: total, due: 0, status: "paid" as PaymentStatus };
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const due = Math.max(0, total - paid);
  return { paid, due, status: (paid <= 0 ? "unpaid" : due === 0 ? "paid" : "partial") as PaymentStatus };
}

/** Új befizetés ellenőrzése: pozitív, legfeljebb a hátralék (túlfizetés nem rögzíthető). */
export function paymentError(amount: number, due: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "PAYMENT_AMOUNT";
  if (amount > due) return "PAYMENT_TOO_MUCH";
  return null;
}

/** A futárnál lévő készpénz: a még le nem adott készpénzes befizetései (a sztornók levonva). */
export function courierCash(payments: Pick<Payment, "method" | "collectedBy" | "handoverId" | "amount" | "collectorId">[], courierUserId: string) {
  return payments
    .filter((p) => p.method === "cash" && p.collectedBy === "courier" && p.collectorId === courierUserId && !p.handoverId)
    .reduce((s, p) => s + p.amount, 0);
}

/** Leadás: az átadott összeg nem negatív; ha eltér az elvárttól, indoklás kell. */
export function handoverError(expected: number, counted: number, note: string): string | null {
  if (!Number.isInteger(counted) || counted < 0) return "HANDOVER_AMOUNT";
  if (expected <= 0 && counted === 0) return "HANDOVER_EMPTY";
  if (counted !== expected && !note.trim()) return "HANDOVER_NOTE_REQUIRED";
  return null;
}

export type CashKind = "counter_sale" | "courier_handover" | "supplier_payment" | "deposit" | "bank_deposit" | "other_in" | "other_out" | "reversal";
export type CashEntry = { id: string; day: string; kind: CashKind; amount: number; document: string; note: string; refId: string | null; reversalOf: string | null; createdAt: string };
/** Kézzel rögzíthető pénztártétel-fajták és irányuk. */
export const MANUAL_CASH_KINDS: Record<"deposit" | "bank_deposit" | "other_in" | "other_out", 1 | -1> = { deposit: 1, other_in: 1, bank_deposit: -1, other_out: -1 };

/** Pénztárnap: nyitó (minden korábbi tétel összege), bevétel, kiadás, záró. */
export function cashDay(before: Pick<CashEntry, "amount">[], entries: Pick<CashEntry, "amount">[]) {
  const opening = before.reduce((s, e) => s + e.amount, 0);
  const income = entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  return { opening, income, expense, closing: opening + income - expense };
}

/** Z-jelentés egyeztetése a nap rögzített fizetéseivel (készpénz és kártya külön). */
export function zReconcile(z: { cash: number; card: number; total: number } | null, payments: Pick<Payment, "method" | "amount">[]) {
  const cash = payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
  const card = payments.filter((p) => p.method === "card").reduce((s, p) => s + p.amount, 0);
  return {
    system: { cash, card, total: cash + card },
    diff: z ? { cash: z.cash - cash, card: z.card - card, total: z.total - (cash + card), zSplit: z.total - z.cash - z.card } : null,
  };
}

/** Beszállítói számla egyenlege és lejártsága. */
export function supplierBalance(total: number, payments: { amount: number }[], dueDate: string, today: string) {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const open = Math.max(0, total - paid);
  return { paid, open, overdue: open > 0 && !!dueDate && dueDate < today };
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const lei = (bani: number) => (bani / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const roDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : iso);
export const cashKindRo: Record<CashKind, string> = {
  counter_sale: "Încasare vânzare (numerar)",
  courier_handover: "Predare numerar curier",
  supplier_payment: "Plată furnizor",
  deposit: "Depunere numerar în casă",
  bank_deposit: "Depunere la bancă",
  other_in: "Alte încasări",
  other_out: "Alte plăți",
  reversal: "Stornare",
};

/** Napi pénztárkönyv-oldal (registru de casă), román nyomtatási kép. */
export function renderCashRegisterHtml(day: string, company: string, entries: CashEntry[], totals: ReturnType<typeof cashDay>, closed: boolean) {
  const rows = entries
    .map(
      (e, i) =>
        `<tr><td>${i + 1}</td><td>${esc(e.document)}</td><td>${esc(cashKindRo[e.kind])}${e.note ? `<small>${esc(e.note)}</small>` : ""}</td><td class="n">${e.amount > 0 ? lei(e.amount) : ""}</td><td class="n">${e.amount < 0 ? lei(-e.amount) : ""}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Registru de casă ${esc(roDate(day))}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #444;padding:4px 5px;vertical-align:top}
th{background:#eee;font-size:11px}td small{display:block;color:#555;font-size:10px}.n{text-align:right;white-space:nowrap}
tfoot td{font-weight:bold}.sigs{display:flex;gap:24px;margin-top:28px}.sig{min-width:180px;border-top:1px solid #444;padding-top:4px}.sig small{display:block;color:#555}
.draft{color:#a00;font-weight:bold}@media print{body{margin:10mm}}
</style></head><body>
<h1>REGISTRU DE CASĂ</h1><p>${company ? `<b>${esc(company)}</b> · ` : ""}Data: <b>${esc(roDate(day))}</b>${closed ? "" : ' · <span class="draft">ziua nu este închisă</span>'}</p>
<table><thead><tr><th>Nr. crt.</th><th>Nr. act casă</th><th>Explicații</th><th>Încasări</th><th>Plăți</th></tr></thead>
<tbody><tr><td></td><td></td><td><b>Sold inițial (report)</b></td><td class="n">${lei(totals.opening)}</td><td></td></tr>${rows}</tbody>
<tfoot><tr><td colspan="3">Total rulaj</td><td class="n">${lei(totals.income)}</td><td class="n">${lei(totals.expense)}</td></tr>
<tr><td colspan="3">Sold final</td><td class="n">${lei(totals.closing)}</td><td></td></tr></tfoot></table>
<div class="sigs"><div class="sig"><span>&nbsp;</span><small>Casier</small></div><div class="sig"><span>&nbsp;</span><small>Compartiment financiar-contabil</small></div></div>
</body></html>`;
}
