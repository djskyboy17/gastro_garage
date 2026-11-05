import { z } from "zod";
import { normalizeSearch } from "../shared/domain.ts";

/**
 * Beszállítói számlák (v65): román Factură és Bon Fiscal beolvasása (Gemini) és bevételezése.
 * Itt csak tiszta, adatbázis nélküli szabályok vannak: a böngésző és a szerver is használja.
 * Pénz egész baniban, a számlán szereplő mennyiség ezredekben, a raktári mennyiség alapegységben (g / ml / db).
 */

export type InvoiceKind = "factura" | "bon_fiscal";
export type InvoiceStatus = "draft" | "received";
export type CostBasis = "net" | "gross";
export type IngredientUnit = "g" | "ml" | "pcs";

/** A számla fájlja: fotó vagy PDF, legfeljebb ennyi bájt (az adatbázis-sor 2 MB-os korlátja miatt, base64-ben is alatta marad). */
export const INVOICE_FILE_MAX_BYTES = 1_400_000;
export const INVOICE_MAX_LINES = 100;

export class InvoiceError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export type InvoiceFileMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
/** A fájl valódi típusa az első bájtok alapján (a kiterjesztés és a böngésző által küldött típus nem számít). */
export function detectInvoiceFile(b: Uint8Array): InvoiceFileMime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

/** Szöveg megtisztítása számfeldolgozáshoz: pénznem, szóközök, nem törhető szóköz ki. */
function cleanNumber(value: string) {
  return value
    .replace(/ | /g, " ")
    .replace(/\b(RON|LEI|LEU|lei|ron|EUR|eur)\b/g, "")
    .replace(/\s+/g, "")
    .replace(/^\+/, "");
}

/**
 * Román (vagy angol) írásmódú szám tizedes része `scale` jegyre kerekítve, egészként (pl. scale=2: bani).
 * „1.234,56” → 123456, „1,234.56” → 123456, „12,5” → 1250, „1234.56” → 123456. Egyetlen vessző mindig tizedesjel (román szokás).
 */
export function parseScaled(value: unknown, scale: number): number | null {
  if (value === null || value === undefined) return null;
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    s = value.toFixed(scale + 2);
  } else if (typeof value === "string") {
    s = cleanNumber(value);
  } else return null;
  if (!s) return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(","),
    lastDot = s.lastIndexOf(".");
  let intPart: string, frac: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const parts = s.split(thousands).join("").split(decimal);
    if (parts.length !== 2) return null;
    [intPart, frac] = parts as [string, string];
  } else if (lastComma >= 0) {
    const parts = s.split(",");
    if (parts.length !== 2) return null;
    [intPart, frac] = parts as [string, string];
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    // Több pont: ezres elválasztó (1.234.567); egy pont: tizedesjel.
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return null;
      intPart = parts.join("");
      frac = "";
    } else [intPart, frac] = parts as [string, string];
  } else {
    intPart = s;
    frac = "";
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (!intPart && !frac)) return null;
  if (intPart.length > 12) return null;
  const digits = frac.padEnd(scale + 1, "0");
  let result = Number(intPart || "0") * 10 ** scale + Number(digits.slice(0, scale) || "0");
  if (Number(digits[scale] ?? "0") >= 5) result += 1;
  return negative ? -result : result;
}
/** Pénzösszeg baniban (2 tizedes). */
export const parseMoney = (value: unknown) => parseScaled(value, 2);
/** Mennyiség ezredekben (3 tizedes), pl. „1,25” kg → 1250. */
export const parseQuantity = (value: unknown) => parseScaled(value, 3);

/** ÁFA-kulcs bázispontban: „21%” → 2100, „9” → 900, „0.11” → 1100. Ismeretlen → null. */
export function parseVatRate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = typeof value === "string" ? value.replace("%", "").trim() : value;
  const hundredths = parseScaled(raw, 2);
  if (hundredths === null || hundredths < 0) return null;
  // Törtként megadott kulcs (0,21 / 0.11): százalékra váltjuk.
  const fraction = typeof raw === "number" ? raw > 0 && raw < 1 : /^0?[.,]\d+$/.test(raw as string);
  const bp = fraction ? hundredths * 100 : hundredths;
  return bp > 10000 ? null : bp;
}

/** Dátum „YYYY-MM-DD” alakra: 2026-11-03, 03.11.2026, 03/11/2026, 03-11-2026, 03.11.26. Érvénytelen → "". */
export function parseInvoiceDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(v))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
    if (match[3]!.length === 2) y += 2000;
  } else return "";
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const date = new Date(iso + "T12:00:00Z");
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso && y >= 2000 && y <= 2100 ? iso : "";
}

/** Adószám egységesítése: „RO 12 345 678” → „RO12345678”, „cui: 12345678” → „12345678”. */
export function normalizeTaxId(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.toUpperCase().replace(/^(CUI|CIF|C\.U\.I\.|C\.I\.F\.|COD FISCAL)[:\s]*/, "").replace(/[\s.\-:]/g, "");
  const match = /^(RO)?(\d{2,10})$/.exec(v);
  return match ? (match[1] ?? "") + match[2] : v.slice(0, 20);
}
/** Román CUI/CIF ellenőrző számjegye (kulcs: 753217532). Az „RO” előtag nem számít. */
export function validTaxId(value: string): boolean {
  const digits = value.replace(/^RO/, "");
  if (!/^\d{2,10}$/.test(digits)) return false;
  const body = digits.slice(0, -1).padStart(9, "0"),
    key = "753217532";
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * Number(key[i]);
  let control = (sum * 10) % 11;
  if (control === 10) control = 0;
  return control === Number(digits.slice(-1));
}

/** Számlán szereplő mértékegység egységesítése: kg, g, l, ml, buc (darab); más egység marad (pl. „bax”). */
export function normalizeUnit(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase().replace(/\.$/, "");
  if (["kg", "kgr", "kilogram", "kilograme", "kilograms"].includes(v)) return "kg";
  if (["g", "gr", "gram", "grame", "grams"].includes(v)) return "g";
  if (["l", "lt", "ltr", "litru", "litri", "liter", "litre"].includes(v)) return "l";
  if (["ml", "mililitru", "mililitri"].includes(v)) return "ml";
  if (["buc", "bc", "bucata", "bucată", "bucati", "bucăți", "pcs", "pc", "db", "ea", "u", "unit", "unitate", "unitati", "unități"].includes(v)) return "buc";
  return v.slice(0, 20);
}
/** Alapértelmezett átváltás: hány alapegység (g / ml / db) egy számlaegység. Ha nem egyértelmű: null (kézzel kell megadni). */
export function defaultFactor(invoiceUnit: string, ingredient: { unit: string; gramsPerPiece?: number | null }): number | null {
  const u = normalizeUnit(invoiceUnit);
  if (ingredient.unit === "g") return u === "kg" ? 1000 : u === "g" ? 1 : null;
  if (ingredient.unit === "ml") return u === "l" ? 1000 : u === "ml" ? 1 : null;
  if (ingredient.unit === "pcs") return u === "buc" ? 1 : null;
  return null;
}
/** Raktári mennyiség: számlamennyiség (ezredekben) × átváltás, egészre kerekítve. */
export const baseQuantityOf = (invoiceQuantity: number, factor: number) => Math.round((invoiceQuantity * factor) / 1000);

export type InvoiceLineAmounts = { lineNet: number | null; lineGross: number | null; vatRate: number | null };
/** Nettó sorérték: a megadott, vagy a bruttóból az ÁFA-kulccsal visszaszámolt (egész banira kerekítve). */
export function netOf(l: InvoiceLineAmounts): number | null {
  if (l.lineNet !== null) return l.lineNet;
  if (l.lineGross === null) return null;
  return l.vatRate === null ? null : Math.round((l.lineGross * 10000) / (10000 + l.vatRate));
}
/** Bruttó sorérték: a megadott, vagy a nettóból az ÁFA-kulccsal számolt. */
export function grossOf(l: InvoiceLineAmounts): number | null {
  if (l.lineGross !== null) return l.lineGross;
  if (l.lineNet === null) return null;
  return l.vatRate === null ? null : Math.round((l.lineNet * (10000 + l.vatRate)) / 10000);
}
/** A raktárba kerülő bekerülési érték a beállítás szerint (nettó / bruttó). Ha nem számolható: null. */
export const costOf = (l: InvoiceLineAmounts, basis: CostBasis) => (basis === "net" ? netOf(l) : grossOf(l));

export type InvoiceLine = InvoiceLineAmounts & {
  id: string;
  position: number;
  description: string;
  invoiceQuantity: number;
  invoiceUnit: string;
  deposit: number;
  skip: number;
  ingredientId: string | null;
  baseQuantity: number;
  /** v72: ténylegesen átvett mennyiség alapegységben; null = a számlázott (baseQuantity). */
  receivedQuantity?: number | null;
  expires: string;
  batch: string;
  lotId?: string | null;
};
export type InvoiceHeader = {
  kind: InvoiceKind;
  purpose?: "stock" | "expense";
  supplierName: string;
  supplierTaxId: string;
  series: string;
  number: string;
  issueDate: string;
  currency: string;
  subtotal: number | null;
  vatTotal: number | null;
  sgrTotal: number;
  total: number | null;
  note: string;
  /** v72: fizetési határidő (YYYY-MM-DD vagy üres). */
  dueDate?: string;
};
/** v72: a számlához tartozó NIR-ek rövid adatai a listához. */
export type InvoiceNir = { id: string; number: string; kind: "receipt" | "reversal"; status: "issued" | "reversed"; issueDate: string };
export type Invoice = InvoiceHeader & {
  id: string;
  status: InvoiceStatus;
  revision: number;
  source: "ai" | "manual";
  model: string;
  hasFile: number;
  /** A számla fájljának típusa (kép vagy PDF), ha van. */
  fileMime: string | null;
  costBasis: string;
  receivedDate: string;
  receivedBy: string;
  receivedAt: string;
  createdBy: string;
  createdAt: string;
  lines: InvoiceLine[];
  /** v72 */
  supplierId?: string | null;
  mismatchReason?: string;
  nirs?: InvoiceNir[];
  /** v72: más számlák (azonosító) ugyanazzal a szállító + széria/szám kulccsal. */
  duplicates?: string[];
};
export type InvoiceMapping = { key: string; ingredientId: string; factor: number };
export type InvoicesData = { invoices: Invoice[]; mappings: InvoiceMapping[]; costBasis: CostBasis; settingsRevision: number; aiEnabled: boolean; nirCommittee?: string };

/**
 * Összegellenőrzés: a sorok bruttó összege (az SGR-betét sorokkal együtt) és a végösszeg eltérése.
 * Kis eltérés (soronként 1 bani kerekítés) nem számít hibának.
 */
export function totalsCheck(h: Pick<InvoiceHeader, "total" | "sgrTotal">, lines: InvoiceLineAmounts[]) {
  const gross = lines.map(grossOf);
  if (h.total === null || gross.some((g) => g === null) || !lines.length) return { linesTotal: null as number | null, difference: null as number | null, ok: true };
  const linesTotal = (gross as number[]).reduce((s, g) => s + g, 0);
  // Ha az SGR nem külön sorként szerepel, a végösszegben benne van.
  const withDeposit = Math.abs(linesTotal - h.total) <= lines.length ? linesTotal : linesTotal + h.sgrTotal;
  const difference = h.total - withDeposit;
  return { linesTotal, difference, ok: Math.abs(difference) <= lines.length };
}

/** Megjegyzett párosítás kulcsa: szállító (adószám, ha van, különben név) + a megnevezés egységesítve. */
export function mappingKey(supplierTaxId: string, supplierName: string, description: string) {
  const supplier = normalizeTaxId(supplierTaxId).replace(/^RO/, "") || normalizeSearch(supplierName).replace(/\s+/g, " ").trim();
  return (supplier + "|" + normalizeSearch(description).replace(/\s+/g, " ").trim()).slice(0, 300);
}

/**
 * Alapanyag-javaslat egy számlasorhoz: először a megjegyzett párosítás, utána a név szerinti egyezés
 * (a megnevezés legalább 3 betűs szavai az alapanyag magyar vagy román nevében). Bizonytalan esetben nincs javaslat.
 */
export function suggestIngredient(
  description: string,
  key: string,
  ingredients: { id: string; hu: string; ro: string }[],
  mappings: InvoiceMapping[],
): { ingredientId: string; factor: number | null; remembered: boolean } | null {
  const remembered = mappings.find((m) => m.key === key && ingredients.some((i) => i.id === m.ingredientId));
  if (remembered) return { ingredientId: remembered.ingredientId, factor: remembered.factor, remembered: true };
  const words = normalizeSearch(description)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  if (!words.length) return null;
  let best: { id: string; score: number } | null = null,
    tie = false;
  for (const i of ingredients) {
    const names = normalizeSearch(i.hu + " " + i.ro)
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const score = words.filter((w) => names.some((n) => n.startsWith(w) || (w.startsWith(n) && n.length >= 4))).length;
    if (!score) continue;
    if (!best || score > best.score) {
      best = { id: i.id, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? { ingredientId: best.id, factor: null, remembered: false } : null;
}

/** Egy sor bevételezhető-e: alapanyag, pozitív raktári mennyiség, lejárat (nem korábbi az átvételnél), kiszámolható érték. */
export function lineReceiveError(l: InvoiceLine, receivedDate: string, basis: CostBasis): string | null {
  if (l.skip) return null;
  if (!l.ingredientId) return "INVOICE_LINE_INGREDIENT";
  if (!(l.baseQuantity > 0)) return "INVOICE_LINE_QUANTITY";
  if (l.receivedQuantity !== null && l.receivedQuantity !== undefined && (!Number.isInteger(l.receivedQuantity) || l.receivedQuantity < 0)) return "INVOICE_LINE_QUANTITY";
  if (!parseInvoiceDate(l.expires) || l.expires < receivedDate) return "INVOICE_LINE_EXPIRES";
  const cost = costOf(l, basis);
  if (cost === null || cost < 0) return "INVOICE_LINE_COST";
  return null;
}

// ——— Gemini válaszának ellenőrzése és egységesítése ———

const looseText = z.preprocess((v) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : v), z.string().max(500));
const looseValue = z.union([z.string().max(60), z.number(), z.null()]).optional();
const rawLine = z
  .object({
    description: looseText,
    quantity: looseValue,
    unit: looseText.optional(),
    unit_price: looseValue,
    line_net: looseValue,
    vat_rate: looseValue,
    line_gross: looseValue,
    is_deposit: z.union([z.boolean(), z.null()]).optional(),
  })
  .passthrough();
export const rawExtraction = z
  .object({
    document_type: looseText.optional(),
    supplier_name: looseText.optional(),
    supplier_tax_id: looseText.optional(),
    series: looseText.optional(),
    number: looseText.optional(),
    issue_date: looseText.optional(),
    currency: looseText.optional(),
    subtotal: looseValue,
    vat_total: looseValue,
    sgr_total: looseValue,
    total: looseValue,
    lines: z.array(rawLine).max(INVOICE_MAX_LINES).optional(),
  })
  .passthrough();

export type ExtractedInvoice = Omit<InvoiceHeader, "note"> & {
  lines: Omit<InvoiceLine, "id" | "ingredientId" | "baseQuantity" | "expires" | "batch" | "skip" | "lotId">[];
};

/** A modell nyers JSON-válaszából ellenőrzött, egységes számlaadat (pénz baniban, dátum ISO, adószám egységesítve). */
export function normalizeExtraction(raw: unknown): ExtractedInvoice {
  const parsed = rawExtraction.safeParse(raw);
  if (!parsed.success) throw new InvoiceError("INVOICE_AI_INVALID");
  const r = parsed.data;
  const kind: InvoiceKind = /bon/i.test(r.document_type ?? "") ? "bon_fiscal" : "factura";
  const lines = (r.lines ?? [])
    .map((l, index) => {
      // v70: a többsoros megnevezés egy sorba (a beviteli mező amúgy is egy soros, és a párosítás kulcsa is így stabil).
      const description = (l.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      const vatRate = parseVatRate(l.vat_rate);
      let lineNet = parseMoney(l.line_net),
        lineGross = parseMoney(l.line_gross);
      const quantity = parseQuantity(l.quantity) ?? 1000;
      // Ha csak egységár van, a sorértéket abból számoljuk (a számla jellege szerint nettó vagy bruttó).
      const unitPrice = parseMoney(l.unit_price);
      if (lineNet === null && lineGross === null && unitPrice !== null) {
        const value = Math.round((unitPrice * quantity) / 1000);
        if (kind === "bon_fiscal") lineGross = value;
        else lineNet = value;
      }
      const deposit = l.is_deposit === true || /\bsgr\b|garan[tț]ie|ambalaj/i.test(description) ? 1 : 0;
      return { position: index + 1, description, invoiceQuantity: Math.max(0, quantity), invoiceUnit: normalizeUnit(l.unit), lineNet, lineGross, vatRate, deposit };
    })
    .filter((l) => l.description || l.lineNet !== null || l.lineGross !== null);
  const sgrFromLines = lines.filter((l) => l.deposit).reduce((s, l) => s + (grossOf(l) ?? 0), 0);
  return {
    kind,
    supplierName: (r.supplier_name ?? "").trim().slice(0, 200),
    supplierTaxId: normalizeTaxId(r.supplier_tax_id),
    series: (r.series ?? "").trim().slice(0, 40),
    number: (r.number ?? "").trim().slice(0, 40),
    issueDate: parseInvoiceDate(r.issue_date),
    currency: /^[A-Z]{3}$/.test((r.currency ?? "").trim().toUpperCase()) ? (r.currency ?? "").trim().toUpperCase() : "RON",
    subtotal: parseMoney(r.subtotal),
    vatTotal: parseMoney(r.vat_total),
    sgrTotal: parseMoney(r.sgr_total) ?? sgrFromLines,
    total: parseMoney(r.total),
    lines,
  };
}

// ——— v72: számla megerősítése és NIR ———

/**
 * Duplikátumkulcs: szállító adószáma (RO nélkül) + széria és szám (csak betűk és számok, nagybetűvel).
 * A szám vezető nullái nem számítanak (0099 = 99): kézzel gyakran elhagyják, az AI megtartja.
 * Üres, ha nincs adószám vagy szám – ilyenkor nem ellenőrizhető.
 */
export function duplicateKey(supplierTaxId: string, series: string, number: string): string {
  const tax = normalizeTaxId(supplierTaxId).replace(/^RO/, "");
  const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const doc = clean(series) + "|" + clean(number).replace(/^0+(?=.)/, "");
  return tax && /\d/.test(number) ? tax + "|" + doc : "";
}

/** Bevételezés előtti fejlécellenőrzés: kötelező mezők, csak RON, és tűrés feletti összegeltérés csak indoklással. */
export function receiveHeaderError(h: InvoiceHeader, lines: InvoiceLineAmounts[], mismatchReason: string): string | null {
  if (!h.supplierName.trim() || !h.supplierTaxId.trim() || !h.number.trim() || !parseInvoiceDate(h.issueDate) || h.total === null) return "INVOICE_HEADER_REQUIRED";
  if (h.currency !== "RON") return "INVOICE_CURRENCY";
  const check = totalsCheck(h, lines);
  if (!check.ok && !mismatchReason.trim()) return "INVOICE_TOTAL_MISMATCH";
  return null;
}

/** A ténylegesen átvett mennyiség (ha nincs külön megadva, a számlázott). */
export const receivedOf = (l: Pick<InvoiceLine, "baseQuantity" | "receivedQuantity">) => (l.receivedQuantity === null || l.receivedQuantity === undefined ? l.baseQuantity : l.receivedQuantity);

/** Arányos érték: a számlázott sorérték az átvett mennyiségre vetítve (egész banira kerekítve). */
export function prorate(value: number | null, invoiced: number, received: number): number | null {
  if (value === null) return null;
  if (invoiced <= 0) return received === 0 ? 0 : value;
  return Math.round((value * received) / invoiced);
}

/** NIR-sor pillanatképe. Mennyiség alapegységben; érték és TVA baniban. */
export type NirLine = {
  position: number;
  description: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  invoiced: number;
  received: number;
  value: number;
  vat: number;
  vatRate: number | null;
  lotId: string | null;
  batch: string;
  expires: string;
};
export type NirContent = {
  supplier: { name: string; taxId: string };
  invoice: { kind: InvoiceKind; series: string; number: string; date: string; total: number | null; currency: string };
  committee: string[];
  costBasis: CostBasis;
  receivedDate: string;
  lines: NirLine[];
  totals: { value: number; vat: number; gross: number };
  reason?: string;
};

/** NIR-sor a számlasorból: érték a bekerülési alap szerint, TVA a bruttó és nettó különbsége – mindkettő az átvett mennyiségre vetítve. */
export function nirLine(l: InvoiceLine, basis: CostBasis, ingredient: { name: string; unit: string }, lotId: string | null, batch: string): NirLine {
  const received = receivedOf(l),
    net = prorate(netOf(l), l.baseQuantity, received),
    gross = prorate(grossOf(l), l.baseQuantity, received),
    value = prorate(costOf(l, basis), l.baseQuantity, received) ?? 0;
  return {
    position: l.position,
    description: l.description,
    ingredientId: l.ingredientId ?? "",
    ingredientName: ingredient.name,
    unit: ingredient.unit,
    invoiced: l.baseQuantity,
    received,
    value,
    vat: net !== null && gross !== null ? gross - net : 0,
    vatRate: l.vatRate,
    lotId,
    batch,
    expires: l.expires,
  };
}
export function nirTotals(lines: NirLine[]) {
  const value = lines.reduce((s, l) => s + l.value, 0),
    vat = lines.reduce((s, l) => s + l.vat, 0);
  return { value, vat, gross: value + vat };
}
/** Sztornó-NIR tartalma: ugyanazok a sorok negatív mennyiséggel és értékkel. */
export function reversalContent(original: NirContent, receivedDate: string, reason: string): NirContent {
  const lines = original.lines.map((l) => ({ ...l, invoiced: -l.invoiced, received: -l.received, value: -l.value, vat: -l.vat }));
  return { ...original, receivedDate, lines, totals: nirTotals(lines), reason };
}
/** Bizottság: soronként egy név, üres sorok nélkül, legfeljebb 10. */
export const committeeNames = (text: string) => text.split(/\r?\n/).map((n) => n.trim()).filter(Boolean).slice(0, 10);
