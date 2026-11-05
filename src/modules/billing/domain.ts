/**
 * Számlázás az Oblióval (v77) – tiszta függvények: vevőadat-ellenőrzés, számla-pillanatkép (tételek összevonása, TVA-bontás
 * bruttó árakból), az Oblio-kérés összeállítása, SPV-állapot, vevői egyenleg. Pénz egész baniban.
 */
import { validTaxId, normalizeTaxId } from "../invoices/domain.ts";

export type BillingKind = "person" | "company";
export type BillingMode = "receipt" | "per_order" | "monthly";
export type BillingProfile = {
  customerId: string;
  kind: BillingKind;
  mode: BillingMode;
  name: string;
  cif: string;
  regCom: string;
  address: string;
  city: string;
  county: string;
  country: string;
  email: string;
  paymentDays: number;
  revision: number;
};
export type BillingSettings = {
  mode: "simulated" | "live";
  companyCif: string;
  seriesName: string;
  stornoSeriesName: string;
  vatFoodBps: number;
  vatDeliveryBps: number;
  /** v83: 1 = áfafizető; 0 = neplătitor de TVA (a TVA-kulcsok nem érvényesek, a számlán 0%). */
  vatPayer: number;
  /** v83: a nem áfafizető cég mentességi megjegyzése a számlán (a könyvelő adja meg). */
  vatNote: string;
  cashCollectType: string;
  receiptSeries: string;
  autoSpv: number;
  revision: number;
};
export const defaultBillingSettings: BillingSettings = {
  mode: "simulated",
  companyCif: "",
  seriesName: "",
  stornoSeriesName: "",
  vatFoodBps: 1100,
  vatDeliveryBps: 2100,
  vatPayer: 0,
  vatNote: "",
  cashCollectType: "Alta incasare numerar",
  receiptSeries: "",
  autoSpv: 1,
  revision: 0,
};
/** Az Oblio készpénzes befizetéstípusai közül választható (a könyvelővel egyeztetendő). */
export const CASH_COLLECT_TYPES = ["Alta incasare numerar", "Chitanta", "Bon fiscal"] as const;

/** A vevőadat hiányossága (null = kiállítható). */
export function profileError(p: Pick<BillingProfile, "kind" | "name" | "cif" | "address" | "city" | "county">): string | null {
  if (!p.name.trim()) return "BILLING_NAME_REQUIRED";
  if (p.kind === "company") {
    if (!validTaxId(normalizeTaxId(p.cif))) return "BILLING_CIF_INVALID";
    if (!p.address.trim() || !p.city.trim() || !p.county.trim()) return "BILLING_ADDRESS_REQUIRED";
  }
  return null;
}

/** A bruttó összegben lévő TVA (bani, kerekítve): bruttó − bruttó / (1 + kulcs). */
export function vatOf(gross: number, bps: number) {
  if (bps <= 0) return 0;
  return gross - Math.round((gross * 10000) / (10000 + bps));
}

export type SnapshotOrder = { id: string; code: string; date: string; deliveryFee: number; items: { ro: string; price: number; quantity: number }[] };
export type InvoiceLine = { name: string; unitPrice: number; quantity: number; vatBps: number; total: number };
export type InvoiceSnapshot = {
  kind: "order" | "monthly";
  period: string;
  issueDate: string;
  dueDate: string;
  buyer: { kind: BillingKind; name: string; cif: string; regCom: string; address: string; city: string; county: string; country: string; email: string };
  orders: { id: string; code: string; date: string }[];
  notes: string[];
  lines: InvoiceLine[];
  total: number;
  vat: { bps: number; base: number; vat: number }[];
  mentions: string;
};

export const addDaysIso = (date: string, days: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** A hónap (YYYY-MM) első és utolsó napja. */
export function monthRange(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("BILLING_PERIOD");
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

/**
 * Számla-pillanatkép a rendelésekből: azonos nevű és árú tételek összevonva, a szállítási díj külön sor (saját TVA-kulccsal),
 * a TVA kulcsonként a bruttó összegből számolva. A pillanatkép a jóváhagyáskor rögzül, a későbbi törzsadat-változás nem írja át.
 */
export function buildSnapshot(input: {
  kind: "order" | "monthly";
  period: string;
  issueDate: string;
  profile: BillingProfile;
  orders: SnapshotOrder[];
  notes: string[];
  settings: Pick<BillingSettings, "vatFoodBps" | "vatDeliveryBps" | "vatPayer" | "vatNote">;
}): InvoiceSnapshot {
  // v83: nem áfafizető cég számláján nincs TVA (0%, TVA-bontás nélkül).
  const payer = !!input.settings.vatPayer;
  const food = payer ? input.settings.vatFoodBps : 0,
    delivery = payer ? input.settings.vatDeliveryBps : 0;
  const lines = new Map<string, InvoiceLine>();
  const add = (name: string, unitPrice: number, quantity: number, vatBps: number) => {
    const key = `${name}|${unitPrice}|${vatBps}`;
    const l = lines.get(key) ?? { name, unitPrice, quantity: 0, vatBps, total: 0 };
    l.quantity += quantity;
    l.total += unitPrice * quantity;
    lines.set(key, l);
  };
  for (const o of input.orders) {
    for (const i of o.items) if (i.quantity > 0) add(i.ro, i.price, i.quantity, food);
    if (o.deliveryFee > 0) add("Taxă livrare", o.deliveryFee, 1, delivery);
  }
  const all = [...lines.values()].filter((l) => l.total !== 0 || l.quantity > 0);
  const byRate = new Map<number, number>();
  for (const l of all) byRate.set(l.vatBps, (byRate.get(l.vatBps) ?? 0) + l.total);
  const vat = !payer ? [] : [...byRate].sort((a, b) => b[0] - a[0]).map(([bps, gross]) => ({ bps, vat: vatOf(gross, bps), base: gross - vatOf(gross, bps) }));
  const p = input.profile;
  const orderRefs = input.orders.map((o) => ({ id: o.id, code: o.code, date: o.date }));
  const mentions = [
    payer ? "" : input.settings.vatNote.trim(),
    input.kind === "monthly" ? `Perioada: ${input.period}` : "",
    `Comenzi: ${orderRefs.map((o) => "#" + o.code).join(", ")}`,
    input.notes.length ? `Avize: ${input.notes.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    kind: input.kind,
    period: input.period,
    issueDate: input.issueDate,
    dueDate: addDaysIso(input.issueDate, p.paymentDays),
    buyer: { kind: p.kind, name: p.name.trim(), cif: p.kind === "company" ? normalizeTaxId(p.cif) : "", regCom: p.regCom.trim(), address: p.address.trim(), city: p.city.trim(), county: p.county.trim(), country: p.country.trim() || "România", email: p.email.trim() },
    orders: orderRefs,
    notes: input.notes,
    lines: all,
    total: all.reduce((s, l) => s + l.total, 0),
    vat,
    mentions: mentions.slice(0, 1000),
  };
}

const lei = (bani: number) => Math.round(bani) / 100;

/** Az Oblio `POST /api/docs/invoice` kérés teste (bruttó árak, `vatIncluded: 1`, készlet nélkül). */
export function oblioInvoicePayload(s: InvoiceSnapshot, settings: Pick<BillingSettings, "companyCif" | "seriesName" | "autoSpv">, idempotencyKey: string, orderNumber: string) {
  return {
    cif: settings.companyCif,
    client: {
      name: s.buyer.name,
      cif: s.buyer.cif,
      rc: s.buyer.regCom,
      address: s.buyer.address,
      state: s.buyer.county,
      city: s.buyer.city,
      country: s.buyer.country,
      email: s.buyer.email,
      vatPayer: s.buyer.cif.toUpperCase().startsWith("RO") ? 1 : 0,
      save: 1,
    },
    issueDate: s.issueDate,
    dueDate: s.dueDate,
    seriesName: settings.seriesName,
    language: "RO",
    precision: 2,
    currency: "RON",
    useStock: 0,
    // Az SPV-be küldést mi indítjuk (az autoSpv beállítás szerint), nem az Oblio-beállítás.
    spvExtern: 0,
    orderNumber,
    mentions: s.mentions,
    idempotencyKey,
    products: s.lines.map((l) => ({
      name: l.name,
      price: lei(l.unitPrice),
      measuringUnit: "buc",
      vatPercentage: l.vatBps / 100,
      vatIncluded: 1,
      quantity: l.quantity,
      productType: "Serviciu",
    })),
  };
}

/** SPV-állapot az Oblio kódjából: -1 nincs beküldve, 0 feldolgozás alatt, 1 elfogadva, 2 hibás. */
export type SpvState = "none" | "processing" | "accepted" | "error";
export function spvState(code: number | null | undefined): SpvState {
  if (code === 1) return "accepted";
  if (code === 0) return "processing";
  if (code === 2) return "error";
  return "none";
}

/** A számla nyitott összege: végösszeg − a rendeléseken rögzített befizetések − a számlára érkezett befizetések. */
export function invoiceOpen(total: number, orderPayments: number, invoicePayments: number) {
  const paid = orderPayments + invoicePayments;
  return { paid, open: Math.max(0, total - paid) };
}

/** Rendelés-befizetés → Oblio befizetéstípus. */
export function collectTypeFor(method: "cash" | "card" | "bank", settings: Pick<BillingSettings, "cashCollectType">) {
  if (method === "card") return "Card";
  if (method === "bank") return "Ordin de plata";
  return settings.cashCollectType;
}
