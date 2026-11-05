import type { Order } from "../shared/domain";
export type Ingredient = {
  id: string;
  hu: string;
  ro: string;
  unit: string;
  packQuantity: number;
  packPrice: number;
  minStock: number;
  allergens: string;
  supplier: string;
  nutrition?: string;
  frozen?: number;
  gramsPerPiece?: number | null;
};
export type Preparation = {
  id: string;
  hu: string;
  ro: string;
  unit: string;
  createdAt: string;
};
export type PreparationLine = {
  id: string;
  versionId: string;
  ingredientId: string;
  quantity: number;
  lossBps: number;
};
export type PreparationVersion = {
  id: string;
  preparationId: string;
  version: number;
  output: number;
  note: string;
  createdAt: string;
  lines: PreparationLine[];
};
export type RecipePreparationLine = {
  id: string;
  recipeId: string;
  preparationId: string;
  quantity: number;
  lossBps: number;
};
export type RecipeLine = {
  id: string;
  recipeId: string;
  ingredientId: string;
  quantity: number;
  lossBps: number;
};
export type Recipe = {
  id: string;
  productId: string;
  version: number;
  yield: number;
  note: string;
  createdAt: string;
  lines: RecipeLine[];
  preparations?: RecipePreparationLine[];
};
export type StockLot = {
  revision?:number;
  adjustmentTotal?:number;
  purchaseLineId?: string | null;
  id: string;
  ingredientId: string;
  batch: string;
  supplier: string;
  received: string;
  expires: string;
  quantity: number;
  remaining: number;
  totalCost: number;
  document: string;
  createdAt: string;
};
export type StockIssue = {
  id: string;
  orderId: string;
  recipeSnapshot: string;
  createdAt: string;
  actor: string;
};
export type StockMove = {
  id: string;
  lotId: string;
  issueId: string | null;
  quantity: number;
  kind: string;
  note: string;
  createdAt: string;
};
export type OperationsData = {
  ingredients: Ingredient[];
  recipes: Recipe[];
  lots: StockLot[];
  issues: StockIssue[];
  moves: StockMove[];
  preparations: Preparation[];
  preparationVersions: PreparationVersion[];
  /** v73: gyártási tételek (nap + étel + állapot) – a lezárt tétel anyaga már ki van adva. */
  batches?: BatchMark[];
  /** Physically used in ready production; raw stock posting waits for the daily close. */
  deferredNeeds?: { day:string; ingredientId:string; quantity:number }[];
};
/** Egy gyártási tétel jelölése (v73); a részletek a production modulban. */
export type BatchMark = { day: string; productId: string; status: "open" | "closed" };
/**
 * A rendelés tételei, amelyek anyagigénye még nincs kiadva: a lezárt gyártási tételhez (nap + étel) tartozó
 * tételek anyaga a tétel bon de consumjával már fogyott, ezért a beszerzési terv nem számolja újra.
 */
export function pendingOrder(order: Order, batches: BatchMark[] = []): Order {
  if (!batches.length) return order;
  const closed = new Set(batches.filter((b) => b.status === "closed" && b.day === order.date).map((b) => b.productId));
  return closed.size ? { ...order, items: order.items.filter((i) => !closed.has(i.productId)) } : order;
}
export const emptyOperations: OperationsData = {
  ingredients: [],
  recipes: [],
  lots: [],
  issues: [],
  moves: [],
  preparations: [],
  preparationVersions: [],
};
export function ceilRatio(numerator: bigint, denominator: bigint) {
  if (numerator < 0n || denominator <= 0n) throw new Error("INVALID_QUANTITY");
  return Number((numerator + denominator - 1n) / denominator);
}
export function grossQuantity(
  net: number,
  lossBps: number,
  portions: number,
  yieldPortions: number,
) {
  if (
    ![net, lossBps, portions, yieldPortions].every(Number.isSafeInteger) ||
    net <= 0 ||
    portions <= 0 ||
    yieldPortions <= 0 ||
    lossBps < 0 ||
    lossBps >= 10000
  )
    throw new Error("INVALID_QUANTITY");
  return ceilRatio(
    BigInt(net) * BigInt(portions) * 10000n,
    BigInt(yieldPortions) * BigInt(10000 - lossBps),
  );
}
export function costFor(
  quantity: number,
  packPrice: number,
  packQuantity: number,
) {
  return ceilRatio(BigInt(quantity) * BigInt(packPrice), BigInt(packQuantity));
}
export function latestRecipe(productId: string, recipes: Recipe[]) {
  return recipes
    .filter((r) => r.productId === productId)
    .sort((a, b) => b.version - a.version)[0];
}
export function latestPreparation(
  preparationId: string,
  versions: PreparationVersion[],
) {
  return versions
    .filter((v) => v.preparationId === preparationId)
    .sort((a, b) => b.version - a.version)[0];
}
/**
 * Egy receptváltozat bruttó alapanyagigénye adott adagszámra, az al-receptek
 * (félkész termékek) legfrissebb változatán keresztül is. Minden lépés felfelé kerekít.
 */
export function explodeRecipe(
  recipe: Recipe,
  portions: number,
  preparationVersions: PreparationVersion[],
) {
  const needs = new Map<string, number>();
  const missingPreparations: string[] = [];
  const preparationVersionIds: string[] = [];
  const add = (id: string, q: number) => needs.set(id, (needs.get(id) ?? 0) + q);
  for (const line of recipe.lines)
    add(
      line.ingredientId,
      grossQuantity(line.quantity, line.lossBps, portions, recipe.yield),
    );
  for (const line of recipe.preparations ?? []) {
    const version = latestPreparation(line.preparationId, preparationVersions);
    if (!version) {
      missingPreparations.push(line.preparationId);
      continue;
    }
    preparationVersionIds.push(version.id);
    const gross = grossQuantity(line.quantity, line.lossBps, portions, recipe.yield);
    for (const p of version.lines)
      add(p.ingredientId, grossQuantity(p.quantity, p.lossBps, gross, version.output));
  }
  return { needs, missingPreparations, preparationVersionIds };
}
export function requirements(
  order: Order,
  recipes: Recipe[],
  preparationVersions: PreparationVersion[] = [],
) {
  const needs = new Map<string, number>();
  const missing: string[] = [];
  const recipeIds: string[] = [];
  for (const item of order.items) {
    const recipe = item.recipeId
      ? recipes.find((r) => r.id === item.recipeId)
      : latestRecipe(item.productId, recipes);
    if (!recipe) {
      missing.push(item.productId);
      continue;
    }
    recipeIds.push(recipe.id);
    const exploded = explodeRecipe(recipe, item.quantity, preparationVersions);
    // Hiányzó al-recept: a teljes étel hiányzó receptnek számít.
    if (exploded.missingPreparations.length) {
      missing.push(item.productId);
      continue;
    }
    for (const id of exploded.preparationVersionIds)
      if (!recipeIds.includes("prep:" + id)) recipeIds.push("prep:" + id);
    for (const [id, q] of exploded.needs) needs.set(id, (needs.get(id) ?? 0) + q);
  }
  return { needs, missing, recipeIds };
}
export function recipeCost(
  recipe: Recipe,
  ingredients: Ingredient[],
  preparationVersions: PreparationVersion[] = [],
) {
  const { needs } = explodeRecipe(recipe, recipe.yield, preparationVersions);
  let batchCost = 0;
  for (const [id, quantity] of needs) {
    const i = ingredients.find((i) => i.id === id);
    if (i) batchCost += costFor(quantity, i.packPrice, i.packQuantity);
  }
  return ceilRatio(BigInt(batchCost), BigInt(recipe.yield));
}
export function usableLots(lots: StockLot[], date: string) {
  return lots
    .filter((l) => l.remaining > 0 && l.received <= date && l.expires >= date)
    .sort(
      (a, b) =>
        a.expires.localeCompare(b.expires) ||
        a.received.localeCompare(b.received) ||
        a.id.localeCompare(b.id),
    );
}
export function allocate(
  needs: Map<string, number>,
  lots: StockLot[],
  date: string,
) {
  const pool = usableLots(lots, date);
  const allocations: {
    lotId: string;
    ingredientId: string;
    quantity: number;
  }[] = [];
  const shortage: { ingredientId: string; quantity: number }[] = [];
  for (const [ingredientId, required] of needs) {
    let left = required;
    for (const lot of pool.filter((l) => l.ingredientId === ingredientId)) {
      const quantity = Math.min(left, lot.remaining);
      if (quantity > 0)
        allocations.push({ lotId: lot.id, ingredientId, quantity });
      left -= quantity;
      if (!left) break;
    }
    if (left > 0) shortage.push({ ingredientId, quantity: left });
  }
  return { allocations, shortage };
}
export function procurementPlan(
  orders: Order[],
  ops: OperationsData,
  date: string,
  minimum = false,
  incoming: { ingredientId: string; quantity: number }[] = [],
) {
  const needed = new Map<string, number>();
  const missing: string[] = [];
  for(const pending of ops.deferredNeeds ?? []) if(pending.day <= date) needed.set(pending.ingredientId,(needed.get(pending.ingredientId)??0)+pending.quantity);
  const issued = new Set(ops.issues.map((i) => i.orderId));
  for (const o of orders.filter(
    (o) =>
      o.date === date &&
      o.status === "confirmed" &&
      o.production !== "ready" &&
      o.delivery === "pending" &&
      !issued.has(o.id),
  )) {
    const req = requirements(pendingOrder(o, ops.batches), ops.recipes, ops.preparationVersions ?? []);
    missing.push(...req.missing);
    for (const [id, qty] of req.needs)
      needed.set(id, (needed.get(id) ?? 0) + qty);
  }
  const usable = usableLots(ops.lots, date);
  return {
    missing: [...new Set(missing)],
    rows: ops.ingredients
      .map((i) => {
        const required = needed.get(i.id) ?? 0;
        const available = usable
          .filter((l) => l.ingredientId === i.id)
          .reduce((s, l) => s + l.remaining, 0);
        const shortage = Math.max(
          0,
          required +
            (minimum ? i.minStock : 0) -
            available -
            incoming
              .filter((l) => l.ingredientId === i.id)
              .reduce((s, l) => s + l.quantity, 0),
        );
        return {
          ingredient: i,
          required,
          available,
          incoming: incoming
            .filter((l) => l.ingredientId === i.id)
            .reduce((s, l) => s + l.quantity, 0),
          shortage,
          estimatedCost: costFor(shortage, i.packPrice, i.packQuantity),
        };
      })
      .filter((r) => r.required > 0 || r.shortage > 0),
  };
}
/** Beérkező, még be nem vételezett beszerzés: a `due` napjától számít készletnek. */
export type InboundLine = { ingredientId: string; quantity: number; due: string };
export type ForwardDay = {
  date: string;
  orders: number;
  portions: number;
  /** Ételek, amelyekhez nincs recept: ezek igénye nem számolható. */
  missing: string[];
  shortage: { ingredientId: string; quantity: number; packs: number; estimatedCost: number }[];
};
const addDay = (date: string, days: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/**
 * Előretekintő beszerzési terv (v25): a `from` naptól `days` napon át, napról napra.
 * A még ki nem adott, visszaigazolt rendelések receptigényét a raktárkészletből vonja le
 * (FEFO: előbb a hamarabb lejáró tétel), a lejárt tételt nem használja, a beérkező beszerzést
 * a határidejétől számítja. Ami nem fedezhető, az aznapi hiány; a hiányt megvettnek tekinti,
 * így a következő napok nem számolják újra.
 */
export function forwardProcurement(
  orders: Order[],
  ops: OperationsData,
  from: string,
  days: number,
  inbound: InboundLine[] = [],
): ForwardDay[] {
  const to = addDay(from, days - 1);
  const issued = new Set(ops.issues.map((i) => i.orderId));
  const pool = [
    ...ops.lots
      .filter((l) => l.remaining > 0)
      .map((l) => ({ ingredientId: l.ingredientId, left: l.remaining, from: l.received, expires: l.expires, key: l.id })),
    ...inbound
      .filter((l) => l.quantity > 0)
      .map((l, i) => ({ ingredientId: l.ingredientId, left: l.quantity, from: l.due < from ? from : l.due, expires: "9999-12-31", key: "inbound:" + i })),
  ];
  const result: ForwardDay[] = [];
  for (let date = from; date <= to; date = addDay(date, 1)) {
    const dayOrders = orders.filter(
      (o) =>
        o.date === date &&
        o.status === "confirmed" &&
        o.production !== "ready" &&
        o.delivery === "pending" &&
        !issued.has(o.id),
    );
    const deferred=(ops.deferredNeeds??[]).filter(n=>(n.day<from?from:n.day)===date);
    if (!dayOrders.length && !deferred.length) continue;
    const needs = new Map<string, number>();
    for(const pending of deferred) needs.set(pending.ingredientId,(needs.get(pending.ingredientId)??0)+pending.quantity);
    const missing = new Set<string>();
    for (const o of dayOrders) {
      const req = requirements(pendingOrder(o, ops.batches), ops.recipes, ops.preparationVersions ?? []);
      req.missing.forEach((id) => missing.add(id));
      for (const [id, q] of req.needs) needs.set(id, (needs.get(id) ?? 0) + q);
    }
    const usable = pool
      .filter((l) => l.left > 0 && l.from <= date && l.expires >= date)
      .sort((a, b) => a.expires.localeCompare(b.expires) || a.from.localeCompare(b.from) || a.key.localeCompare(b.key));
    const shortage: ForwardDay["shortage"] = [];
    for (const [ingredientId, required] of needs) {
      let left = required;
      for (const lot of usable.filter((l) => l.ingredientId === ingredientId)) {
        const used = Math.min(left, lot.left);
        lot.left -= used;
        left -= used;
        if (!left) break;
      }
      if (left > 0) {
        const i = ops.ingredients.find((i) => i.id === ingredientId);
        const packQuantity = i?.packQuantity && i.packQuantity > 0 ? i.packQuantity : 1;
        shortage.push({
          ingredientId,
          quantity: left,
          packs: ceilRatio(BigInt(left), BigInt(packQuantity)),
          estimatedCost: i ? costFor(left, i.packPrice, packQuantity) : 0,
        });
      }
    }
    result.push({
      date,
      orders: dayOrders.length,
      portions: dayOrders.reduce((s, o) => s + o.items.reduce((n, i) => n + i.quantity, 0), 0),
      missing: [...missing],
      shortage,
    });
  }
  return result;
}
