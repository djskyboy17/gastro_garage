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
};
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
  const issued = new Set(ops.issues.map((i) => i.orderId));
  for (const o of orders.filter(
    (o) =>
      o.date === date &&
      o.status === "confirmed" &&
      o.production !== "ready" &&
      o.delivery === "pending" &&
      !issued.has(o.id),
  )) {
    const req = requirements(o, ops.recipes, ops.preparationVersions ?? []);
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
