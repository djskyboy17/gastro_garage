/**
 * Gyártási tétel és bon de consum (v73) – tiszta függvények (a szerver és a felület is használja).
 * Ételenként és naponként egy tétel; lezáráskor a tényleges adagszámra fogy az anyag (FEFO), bon de consummal.
 */
import type { Order } from "../shared/domain.ts";
import {
  explodeRecipe,
  type OperationsData,
  type Recipe,
  type PreparationVersion,
  type StockLot,
} from "../inventory/domain.ts";

export type BatchStatus = "open" | "closed";
export type ProductionBatch = {
  id: string;
  day: string;
  productId: string;
  code: string;
  recipeId: string | null;
  preparationVersionIds: string[];
  ordered: number;
  planned: number;
  actual: number | null;
  issuedBefore: number;
  status: BatchStatus;
  revision: number;
  consumptionId: string | null;
  useBy: string | null;
  note: string;
  createdAt: string;
  closedAt: string | null;
};
export type ConsumptionRef = { id: string; number: string; status: "issued" | "reversed"; kind: "consumption" | "reversal" };
export type ProductionRow = {
  productId: string;
  hu: string;
  ro: string;
  /** A nap visszaigazolt rendeléseinek adagszáma ebből az ételből. */
  ordered: number;
  /** Ebből a rendelésenként (a régi módon) már kiadott adagok. */
  issued: number;
  /** Késznek jelölt adagok. */
  ready: number;
  hasRecipe: boolean;
  /** v74: korábbi napokról megmaradt, ma még kiadható adag. */
  opening: number;
  batch: ProductionBatch | null;
  documents: ConsumptionRef[];
  /** v74: bon de predare bizonylatok (ha be van kapcsolva). */
  handovers: { id: string; number: string; kind: "issue" | "reversal"; status: "issued" | "reversed" }[];
};
export type ProductionDay = { date: string; marginBps: number; settingsRevision: number; dayClosed: boolean; rows: ProductionRow[] };

export const MARGIN_MAX_BPS = 10000;
export const PORTIONS_MAX = 100000;

/** Javasolt adagszám: rendelt + ráhagyás, felfelé kerekítve (0 rendelésnél 0). */
export function suggestedPortions(ordered: number, marginBps: number): number {
  if (ordered <= 0) return 0;
  return Math.ceil((ordered * (10000 + marginBps)) / 10000);
}

/** Egy nap rendelési igénye ételenként: rendelt, rendelésenként már kiadott és kész adag. */
export function dayDemand(orders: Order[], day: string, issuedOrderIds: Set<string>) {
  const demand = new Map<string, { hu: string; ro: string; ordered: number; issued: number; ready: number }>();
  for (const o of orders) {
    if (o.date !== day || o.status !== "confirmed") continue;
    for (const i of o.items) {
      const d = demand.get(i.productId) ?? { hu: i.hu, ro: i.ro, ordered: 0, issued: 0, ready: 0 };
      d.ordered += i.quantity;
      if (issuedOrderIds.has(o.id)) d.issued += i.quantity;
      if (i.ready) d.ready += i.quantity;
      demand.set(i.productId, d);
    }
  }
  return demand;
}

/** Ennyi adagra kell anyag a tétel lezárásakor: a tényleges adagból a rendelésenként már kiadottak levonva. */
export const portionsToIssue = (actual: number, issuedBefore: number) => Math.max(0, actual - issuedBefore);

/** A tétel receptpillanatképe: csak a rögzített al-receptváltozatok maradnak, így a „legfrissebb” a rögzített. */
export function snapshotOps<T extends Pick<OperationsData, "preparationVersions">>(ops: T, preparationVersionIds: string[]): T {
  const keep = new Set(preparationVersionIds);
  return { ...ops, preparationVersions: ops.preparationVersions.filter((v) => keep.has(v.id)) };
}

/** Bruttó anyagigény a tétel receptjéből adott adagszámra (a rögzített al-receptváltozatokkal). */
export function batchNeeds(recipe: Recipe, portions: number, preparationVersions: PreparationVersion[], preparationVersionIds: string[]) {
  if (portions <= 0) return new Map<string, number>();
  const keep = new Set(preparationVersionIds);
  const result = explodeRecipe(recipe, portions, preparationVersions.filter((v) => keep.has(v.id)));
  if (result.missingPreparations.length) throw new Error("MISSING_RECIPE");
  return result.needs;
}

/** Egy raktári tételből kiadott mennyiség értéke a bekerülési árból (bani, kerekítve). */
export function lotValue(quantity: number, lot: Pick<StockLot, "quantity" | "totalCost">): number {
  if (lot.quantity <= 0 || quantity === 0) return 0;
  const sign = quantity < 0 ? -1 : 1;
  const q = BigInt(Math.abs(quantity));
  return sign * Number((q * BigInt(lot.totalCost) * 2n + BigInt(lot.quantity)) / (BigInt(lot.quantity) * 2n));
}

export type BcLot = { lotId: string; batch: string; expires: string; quantity: number; value: number };
export type BcLine = { ingredientId: string; name: string; unit: string; planned: number; quantity: number; value: number; lots: BcLot[] };
export type BcContent = {
  batch: { id: string; code: string; day: string };
  product: { ro: string; hu: string };
  portions: { actual: number; issuedBefore: number; consumed: number };
  recipe: { id: string; version: number };
  note: string;
  lines: BcLine[];
  totalValue: number;
  reason?: string;
};

/** BC-sorok a kiosztásból (FEFO) – alapanyagonként a felhasznált raktári tételekkel és értékkel. */
export function bcLines(
  planned: Map<string, number>,
  actual: Map<string, number>,
  allocations: { lotId: string; ingredientId: string; quantity: number }[],
  lots: StockLot[],
  ingredients: { id: string; ro: string; unit: string }[],
): BcLine[] {
  return [...actual].map(([ingredientId, quantity]) => {
    const i = ingredients.find((x) => x.id === ingredientId);
    const used = allocations
      .filter((a) => a.ingredientId === ingredientId)
      .map((a) => {
        const lot = lots.find((l) => l.id === a.lotId)!;
        return { lotId: a.lotId, batch: lot.batch, expires: lot.expires, quantity: a.quantity, value: lotValue(a.quantity, lot) };
      });
    return {
      ingredientId,
      name: i?.ro ?? ingredientId,
      unit: i?.unit ?? "g",
      planned: planned.get(ingredientId) ?? 0,
      quantity,
      value: used.reduce((s, l) => s + l.value, 0),
      lots: used,
    };
  });
}

/** Sztornó-BC tartalma: minden mennyiség és érték ellentétes előjellel, indoklással. */
export function reversalBc(c: BcContent, reason: string): BcContent {
  return {
    ...c,
    reason,
    lines: c.lines.map((l) => ({
      ...l,
      planned: -l.planned,
      quantity: -l.quantity,
      value: -l.value,
      lots: l.lots.map((x) => ({ ...x, quantity: -x.quantity, value: -x.value })),
    })),
    totalValue: -c.totalValue,
  };
}

/** A lezárás ellenőrzése: a sorok pontosan a terv alapanyagai; eltérésnél indoklás kell. */
export function closeLinesError(planned: Map<string, number>, actual: { ingredientId: string; quantity: number }[], note: string): string | null {
  const keys = new Set(actual.map((l) => l.ingredientId));
  if (keys.size !== actual.length || keys.size !== planned.size || [...keys].some((k) => !planned.has(k))) return "INVALID_ITEM";
  if (actual.some((l) => planned.get(l.ingredientId) !== l.quantity) && !note.trim()) return "ACTUAL_NOTE_REQUIRED";
  return null;
}

/**
 * Figyelmeztetés (nem tiltás): a nap ételei, amelyekből van késznek jelölt adag, de nincs lezárt gyártási tétel
 * (és nem is rendelésenként adták ki az anyagukat). Recept nélküli ételre nem figyelmeztet.
 */
export function unbatchedReady(orders: Order[], ops: Pick<OperationsData, "issues" | "recipes" | "batches">, day: string): { productId: string; hu: string; ro: string }[] {
  const issued = new Set(ops.issues.map((i) => i.orderId));
  const closed = new Set((ops.batches ?? []).filter((b) => b.day === day && b.status === "closed").map((b) => b.productId));
  const withRecipe = new Set(ops.recipes.map((r) => r.productId));
  const out = new Map<string, { productId: string; hu: string; ro: string }>();
  for (const o of orders) {
    if (o.date !== day || o.status !== "confirmed" || issued.has(o.id)) continue;
    for (const i of o.items)
      if (i.ready && !closed.has(i.productId) && withRecipe.has(i.productId)) out.set(i.productId, { productId: i.productId, hu: i.hu, ro: i.ro });
  }
  return [...out.values()];
}

/**
 * v78: „Nap lezárása recept szerint” terve. Lezárandó minden recepttel rendelkező étel, amelyből aznap rendeltek vagy van
 * nyitott tétele, és még nincs lezárt tétele. Adagszám: a nyitott tétel tervezett adagja (ha van), különben a rendelt.
 * Recept nélküli étel kimarad (nincs mit kiadni).
 */
export function bulkClosePlan(
  demand: { productId: string; ordered: number }[],
  batches: { id: string; productId: string; status: string; planned: number }[],
  withRecipe: Set<string>,
) {
  const ids = [...new Set([...demand.filter((d) => d.ordered > 0).map((d) => d.productId), ...batches.filter((b) => b.status === "open").map((b) => b.productId)])];
  const steps: { productId: string; batchId: string | null; actual: number }[] = [];
  const noRecipe: string[] = [];
  for (const productId of ids) {
    const batch = batches.find((b) => b.productId === productId);
    if (batch?.status === "closed") continue;
    if (!withRecipe.has(productId)) {
      if (!batch) noRecipe.push(productId);
      continue;
    }
    const ordered = demand.find((d) => d.productId === productId)?.ordered ?? 0;
    steps.push({ productId, batchId: batch?.id ?? null, actual: batch && batch.planned > 0 ? batch.planned : ordered });
  }
  return { steps, noRecipe };
}
