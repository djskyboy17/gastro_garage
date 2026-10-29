import type { Product } from "../shared/domain";
import {
  latestPreparation,
  latestRecipe,
  type Ingredient,
  type OperationsData,
  type Recipe,
} from "./domain.ts";

/** Tápérték-mezők (ANPC 201/2022): 100 g-ra, ml-ben mért alapanyagnál 100 ml-re. */
export const nutrientKeys = [
  "energyKj",
  "energyKcal",
  "fat",
  "saturates",
  "carbs",
  "sugars",
  "protein",
  "salt",
] as const;
export type NutrientKey = (typeof nutrientKeys)[number];
/** Értékek századokban (2,20 g → 220), hogy ne kelljen lebegőpontos számot tárolni. */
export type Nutrition = Record<NutrientKey, number>;

const MAX_HUNDREDTHS = 10_000_000;

export function parseNutrition(text: string | undefined | null): Nutrition | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const result = {} as Nutrition;
    for (const key of nutrientKeys) {
      const v = value[key];
      if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > MAX_HUNDREDTHS) return null;
      result[key] = v as number;
    }
    return result;
  } catch {
    return null;
  }
}

export function serializeNutrition(n: Nutrition | null): string {
  if (!n) return "";
  return JSON.stringify(Object.fromEntries(nutrientKeys.map((k) => [k, n[k]])));
}

export type InfoNode = {
  name: { hu: string; ro: string };
  /** Nettó tömeg grammban a recept teljes adagszámára (a sorrendhez). */
  grams: number;
  frozen: boolean;
  children?: InfoNode[];
};

export type DishInfo = {
  recipeId: string;
  ingredients: InfoNode[];
  allergens: string[];
  /** Tápérték 100 g késztermékre, századokban; `null`, ha bármelyik adat hiányzik. */
  nutritionPer100g: Nutrition | null;
  /** Alapanyagok, amelyeknél hiányzik a tápérték vagy a darabtömeg. */
  missing: { hu: string; ro: string }[];
  /** Hiányzó al-recept-változat (ilyenkor az összetevőlista is hiányos). */
  missingPreparations: string[];
};

/** Nettó mennyiség grammban: ml ≈ g (sűrűség 1), darabnál a darabtömeg kell. */
function gramsOf(i: Ingredient, quantity: number): number | null {
  if (i.unit === "pcs") return i.gramsPerPiece ? quantity * i.gramsPerPiece : null;
  return quantity;
}

type Leaf = { ingredient: Ingredient; quantity: number };

/**
 * Az étel ételinformációja a legfrissebb receptváltozatból (és al-receptekből):
 * összetevők csökkenő tömeg szerint, allergének, tápérték 100 g késztermékre.
 */
export function dishInfo(product: Product, ops: OperationsData): DishInfo | null {
  const recipe = latestRecipe(product.id, ops.recipes);
  if (!recipe) return null;
  return recipeInfo(product, recipe, ops);
}

export function recipeInfo(product: Product, recipe: Recipe, ops: OperationsData): DishInfo {
  const ingredient = (id: string) => ops.ingredients.find((i) => i.id === id);
  const leaves: Leaf[] = [];
  const missingPreparations: string[] = [];
  const nodes: InfoNode[] = [];

  for (const line of recipe.lines) {
    const i = ingredient(line.ingredientId);
    if (!i) continue;
    leaves.push({ ingredient: i, quantity: line.quantity });
    nodes.push({ name: { hu: i.hu, ro: i.ro }, grams: gramsOf(i, line.quantity) ?? 0, frozen: !!i.frozen });
  }

  for (const line of recipe.preparations ?? []) {
    const prep = ops.preparations.find((p) => p.id === line.preparationId);
    const version = latestPreparation(line.preparationId, ops.preparationVersions);
    if (!prep || !version) {
      missingPreparations.push(line.preparationId);
      continue;
    }
    const children: InfoNode[] = [];
    for (const p of version.lines) {
      const i = ingredient(p.ingredientId);
      if (!i) continue;
      // Az al-recept nettó alapanyaga a felhasznált nettó mennyiség arányában.
      const quantity = (p.quantity * line.quantity) / version.output;
      leaves.push({ ingredient: i, quantity });
      children.push({ name: { hu: i.hu, ro: i.ro }, grams: gramsOf(i, quantity) ?? 0, frozen: !!i.frozen });
    }
    children.sort((a, b) => b.grams - a.grams);
    nodes.push({ name: { hu: prep.hu, ro: prep.ro }, grams: line.quantity, frozen: false, children });
  }
  nodes.sort((a, b) => b.grams - a.grams);

  const allergens = new Set(product.allergens.split(",").filter(Boolean));
  for (const leaf of leaves) for (const a of leaf.ingredient.allergens.split(",").filter(Boolean)) allergens.add(a);

  const missing: { hu: string; ro: string }[] = [];
  const totals = Object.fromEntries(nutrientKeys.map((k) => [k, 0])) as Nutrition;
  for (const { ingredient: i, quantity } of leaves) {
    const n = parseNutrition(i.nutrition);
    // ml-ben mért alapanyag tápértéke 100 ml-re szól, a többié 100 g-ra.
    const basis = i.unit === "ml" ? quantity : gramsOf(i, quantity);
    if (!n || basis === null) {
      if (!missing.some((m) => m.ro === i.ro)) missing.push({ hu: i.hu, ro: i.ro });
      continue;
    }
    for (const k of nutrientKeys) totals[k] += (basis * n[k]) / 100;
  }

  // Kész tömeg = adagszám × adagtömeg; tápérték 100 g-ra = összes / kész tömeg × 100.
  const finishedGrams = recipe.yield * product.portion;
  const nutritionPer100g =
    missing.length === 0 && missingPreparations.length === 0 && finishedGrams > 0
      ? (Object.fromEntries(
          nutrientKeys.map((k) => [k, Math.round((totals[k] * 100) / finishedGrams)]),
        ) as Nutrition)
      : null;

  return {
    recipeId: recipe.id,
    ingredients: nodes,
    allergens: [...allergens].sort(),
    nutritionPer100g,
    missing,
    missingPreparations,
  };
}

/** Az összetevőlista szövegként: „Liszt, Mártás (Tejszín*, Vaj)”; `*` = fagyasztott. */
export function ingredientText(nodes: InfoNode[], lang: "hu" | "ro"): string {
  return nodes
    .map((n) => {
      const label = n.name[lang] + (n.frozen ? "*" : "");
      return n.children?.length ? `${label} (${ingredientText(n.children, lang)})` : label;
    })
    .join(", ");
}

export function hasFrozen(nodes: InfoNode[]): boolean {
  return nodes.some((n) => n.frozen || hasFrozen(n.children ?? []));
}
