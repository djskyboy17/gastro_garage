/**
 * Készétel-készlet, napi zárás, selejt (v74) – tiszta függvények (szerver, felület és teszt is használja).
 * A lezárt gyártási tétel tényleges adagjai a készletbe kerülnek; mindig a legrégebbi még fogyasztható tétel fogy először.
 */

/** Egy gyártási tétel készétel-készlete egy nap elején. */
export type FinishedLot = {
  batchId: string;
  productId: string;
  code: string;
  /** Gyártási nap. */
  day: string;
  /** Utolsó nap, amikor még kiadható (fogyaszthatóság; ha nincs megadva, csak a gyártás napján). */
  useBy: string | null;
  /** Ennyi adag van belőle a nap elején (tényleges adag − a korábbi napok mozgásai). */
  remaining: number;
};
export type FinishedKind = "sold" | "staff" | "waste" | "donation";
export const FINISHED_KINDS: FinishedKind[] = ["sold", "staff", "donation", "waste"];

export const lastUsableDay = (lot: Pick<FinishedLot, "day" | "useBy">) => lot.useBy ?? lot.day;

/** Az adott napon kiadható tételek, a legrégebbi elöl (gyártási nap, majd lejárat, majd kód). */
export function usableFinished(lots: FinishedLot[], day: string) {
  return lots
    .filter((l) => l.remaining > 0 && l.day <= day && lastUsableDay(l) >= day)
    .sort((a, b) => a.day.localeCompare(b.day) || lastUsableDay(a).localeCompare(lastUsableDay(b)) || a.code.localeCompare(b.code));
}

/** Napi zárás bemenete ételenként (a konyha írja be). */
export type DayInput = { productId: string; staff: number; waste: number; donation: number; wasteNote: string };
/** Napi zárás sora ételenként. */
export type DayRow = {
  productId: string;
  hu: string;
  ro: string;
  /** Korábbi napokról megmaradt, ma még kiadható adag. */
  opening: number;
  /** A mai lezárt gyártási tétel adagja. */
  produced: number;
  /** A nap visszaigazolt rendeléseiből a készletből kiszolgált adag (a rendelésenként kiadott régi módú rendelések nélkül). */
  sold: number;
  staff: number;
  waste: number;
  donation: number;
  wasteNote: string;
  /** Másnapra marad (számolt). */
  closing: number;
  moves: { batchId: string; kind: FinishedKind; quantity: number }[];
};
export type DayCloseError = { productId: string; code: "DAY_SHORTAGE" | "DAY_EXPIRED_LEFTOVER" | "DAY_WASTE_NOTE" };

/**
 * A napi zárás kiszámítása: ételenként a készletből FEFO szerint előbb az eladás, majd a dolgozói étkezés, az adomány
 * és a selejt fogy. A záró adag nem lehet negatív, és a ma lejáró tételből nem maradhat semmi.
 */
export function planDayClose(
  day: string,
  products: { productId: string; hu: string; ro: string; sold: number }[],
  lots: FinishedLot[],
  inputs: DayInput[],
): { rows: DayRow[]; errors: DayCloseError[] } {
  const ids = [...new Set([...products.map((p) => p.productId), ...usableFinished(lots, day).map((l) => l.productId)])];
  const rows: DayRow[] = [];
  const errors: DayCloseError[] = [];
  for (const productId of ids) {
    const p = products.find((x) => x.productId === productId);
    const input = inputs.find((i) => i.productId === productId);
    const pool = usableFinished(lots, day)
      .filter((l) => l.productId === productId)
      .map((l) => ({ ...l, left: l.remaining }));
    const opening = pool.filter((l) => l.day < day).reduce((s, l) => s + l.left, 0);
    const produced = pool.filter((l) => l.day === day).reduce((s, l) => s + l.left, 0);
    const want: Record<FinishedKind, number> = { sold: p?.sold ?? 0, staff: input?.staff ?? 0, donation: input?.donation ?? 0, waste: input?.waste ?? 0 };
    const moves: DayRow["moves"] = [];
    let short = false;
    for (const kind of FINISHED_KINDS) {
      let need = want[kind];
      for (const lot of pool) {
        if (!need) break;
        const q = Math.min(need, lot.left);
        if (q > 0) {
          moves.push({ batchId: lot.batchId, kind, quantity: q });
          lot.left -= q;
          need -= q;
        }
      }
      if (need > 0) short = true;
    }
    const closing = pool.reduce((s, l) => s + l.left, 0);
    if (short) errors.push({ productId, code: "DAY_SHORTAGE" });
    else if (pool.some((l) => l.left > 0 && lastUsableDay(l) <= day)) errors.push({ productId, code: "DAY_EXPIRED_LEFTOVER" });
    if (want.waste > 0 && !(input?.wasteNote ?? "").trim()) errors.push({ productId, code: "DAY_WASTE_NOTE" });
    rows.push({
      productId,
      hu: p?.hu ?? productId,
      ro: p?.ro ?? productId,
      opening,
      produced,
      sold: want.sold,
      staff: want.staff,
      waste: want.waste,
      donation: want.donation,
      wasteNote: input?.wasteNote ?? "",
      closing: short ? opening + produced - want.sold - want.staff - want.donation - want.waste : closing,
      moves,
    });
  }
  return { rows, errors };
}

/** A tétel készlete egy nap elején: tényleges adag − a korábbi napok mozgásai. */
export function remainingAt(actual: number, moves: { day: string; quantity: number }[], day: string) {
  return actual - moves.filter((m) => m.day < day).reduce((s, m) => s + m.quantity, 0);
}

/** Egy adag selejt értéke a tétel bon de consumjából (BC-érték / a BC-n kiadott adag), baniban, kerekítve. */
export function portionValue(quantity: number, bcTotal: number, bcPortions: number) {
  if (bcPortions <= 0 || quantity <= 0 || bcTotal <= 0) return 0;
  return Math.round((quantity * bcTotal) / bcPortions);
}

/**
 * Címkéhez: a nap rendelési tételei (a rendelés ideje szerint) melyik gyártási tételből kapják az adagjukat –
 * a korábban leadott rendelések kapják a régebbi (maradék) tételt. Egy rendelési tétel több tételre is eshet.
 * Amire nem jut tétel, annál üres a lista (a címke a régi, számolt tételszámot mutatja).
 */
export function labelAllocation(
  items: { itemId: string; productId: string; orderTime: string; orderId: string; quantity: number }[],
  lots: FinishedLot[],
  day: string,
) {
  const pool = usableFinished(lots, day).map((l) => ({ ...l, left: l.remaining }));
  const result = new Map<string, { batchId: string; quantity: number }[]>();
  const sorted = [...items].sort((a, b) => a.orderTime.localeCompare(b.orderTime) || a.orderId.localeCompare(b.orderId) || a.itemId.localeCompare(b.itemId));
  for (const item of sorted) {
    const parts: { batchId: string; quantity: number }[] = [];
    let need = item.quantity;
    for (const lot of pool.filter((l) => l.productId === item.productId)) {
      if (!need) break;
      const q = Math.min(need, lot.left);
      if (q > 0) {
        parts.push({ batchId: lot.batchId, quantity: q });
        lot.left -= q;
        need -= q;
      }
    }
    result.set(item.itemId, parts);
  }
  return result;
}

/** Selejt-PV (proces-verbal de casare) tartalma. */
export type WriteOffContent = {
  day: string;
  committee: string[];
  lines: { productId: string; ro: string; hu: string; code: string; batchDay: string; quantity: number; reason: string; value: number; unit?: string }[];
  totalValue: number;
  reason?: string;
  /** v100: alapanyag-selejt a raktárból (a sorok raktári tételek, mennyiség alapegységben). */
  kind?: "materials";
  company?: string;
  signer?: { name: string; at: string };
};
/** Bon de predare tartalma (a kész étel átadása a készletbe). */
export type HandoverContent = {
  batch: { id: string; code: string; day: string };
  product: { ro: string; hu: string };
  portions: number;
  useBy: string | null;
  value: number;
  reason?: string;
};
export function reversalWriteOff(c: WriteOffContent, reason: string): WriteOffContent {
  return { ...c, reason, lines: c.lines.map((l) => ({ ...l, quantity: -l.quantity, value: -l.value })), totalValue: -c.totalValue };
}
export function reversalHandover(c: HandoverContent, reason: string): HandoverContent {
  return { ...c, reason, portions: -c.portions, value: -c.value };
}
