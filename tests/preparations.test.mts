import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyOperations,
  procurementPlan,
  recipeCost,
  requirements,
  type Ingredient,
  type OperationsData,
  type PreparationVersion,
  type Recipe,
} from "../src/modules/inventory/domain.ts";
import {
  dishInfo,
  ingredientText,
  parseNutrition,
  serializeNutrition,
  type Nutrition,
} from "../src/modules/inventory/nutrition.ts";
import type { Order, Product } from "../src/modules/shared/domain.ts";

const nutrition = (kcal: number, extra: Partial<Nutrition> = {}) =>
  serializeNutrition({
    energyKj: Math.round(kcal * 418.4),
    energyKcal: kcal * 100,
    fat: 0,
    saturates: 0,
    carbs: 0,
    sugars: 0,
    protein: 0,
    salt: 0,
    ...extra,
  });

const ingredient = (id: string, extra: Partial<Ingredient> = {}): Ingredient => ({
  id,
  hu: id + "-hu",
  ro: id + "-ro",
  unit: "g",
  packQuantity: 1000,
  packPrice: 1000,
  minStock: 0,
  allergens: "",
  supplier: "",
  nutrition: nutrition(100),
  frozen: 0,
  gramsPerPiece: null,
  ...extra,
});

const product = (id: string, portion: number, allergens = ""): Product => ({
  id,
  hu: id + " hu",
  ro: id + " ro",
  descriptionHu: "",
  descriptionRo: "",
  category: "main",
  price: 1000,
  portion,
  allergens,
  active: 1,
});

const order = (productId: string, quantity: number, recipeId: string | null = null): Order =>
  ({
    id: "o-" + productId,
    customerId: "c",
    customerName: "Example",
    address: "",
    phone: "",
    date: "2026-10-29",
    time: "12:00",
    note: "",
    production: "queued",
    delivery: "pending",
    payment: "unpaid",
    status: "confirmed",
    revision: 0,
    createdAt: "",
    items: [
      { id: "it", orderId: "o", productId, hu: "", ro: "", quantity, price: 1000, allergens: "", recipeId },
    ],
  }) as Order;

// Alaplé: 2000 g csont → 5000 ml.
const stockV1: PreparationVersion = {
  id: "stock-v1",
  preparationId: "stock",
  version: 1,
  output: 5000,
  note: "",
  createdAt: "",
  lines: [{ id: "sl", versionId: "stock-v1", ingredientId: "bones", quantity: 2000, lossBps: 0 }],
};
const soup: Recipe = {
  id: "soup-r1",
  productId: "soup",
  version: 1,
  yield: 1,
  note: "",
  createdAt: "",
  lines: [],
  preparations: [{ id: "rp", recipeId: "soup-r1", preparationId: "stock", quantity: 300, lossBps: 0 }],
};
const ops = (extra: Partial<OperationsData> = {}): OperationsData => ({
  ...emptyOperations,
  ingredients: [ingredient("bones", { nutrition: nutrition(60) })],
  recipes: [soup],
  preparations: [{ id: "stock", hu: "Alaplé", ro: "Supă de bază", unit: "ml", createdAt: "" }],
  preparationVersions: [stockV1],
  ...extra,
});

test("1. 300 ml alaplé (2000 g csont → 5000 ml) → 120 g csont az anyagigényben és a beszerzésben", () => {
  const req = requirements(order("soup", 1), soup.id ? [soup] : [], [stockV1]);
  assert.equal(req.needs.get("bones"), 120);
  assert.deepEqual(req.missing, []);
  const plan = procurementPlan([order("soup", 1)], ops(), "2026-10-29");
  assert.equal(plan.rows[0]?.required, 120);
  assert.equal(plan.rows[0]?.shortage, 120);
});

test("Al-recept veszteséggel: mindkét lépés felfelé kerekít", () => {
  const recipe: Recipe = {
    ...soup,
    yield: 3,
    preparations: [{ id: "rp", recipeId: "soup-r1", preparationId: "stock", quantity: 100, lossBps: 1000 }],
  };
  // 100 ml / 3 adag × 1 adag / 0,9 → 38 ml (felfelé); 2000 × 38 / 5000 = 15,2 → 16 g
  assert.equal(requirements(order("soup", 1, "soup-r1"), [recipe], [stockV1]).needs.get("bones"), 16);
});

test("A legfrissebb al-recept-változat számít, és a recept-azonosítók között szerepel (elavult előnézet)", () => {
  const v2: PreparationVersion = { ...stockV1, id: "stock-v2", version: 2, output: 4000 };
  const before = requirements(order("soup", 1), [soup], [stockV1]);
  const after = requirements(order("soup", 1), [soup], [stockV1, v2]);
  assert.deepEqual(before.recipeIds, ["soup-r1", "prep:stock-v1"]);
  assert.deepEqual(after.recipeIds, ["soup-r1", "prep:stock-v2"]);
  assert.equal(after.needs.get("bones"), 150);
});

test("Hiányzó al-recept-változat hiányzó receptként jelenik meg", () => {
  const req = requirements(order("soup", 1), [soup], []);
  assert.deepEqual(req.missing, ["soup"]);
  assert.equal(req.needs.size, 0);
  assert.deepEqual(procurementPlan([order("soup", 1)], ops({ preparationVersions: [] }), "2026-10-29").missing, ["soup"]);
});

test("Az önköltség az al-recept alapanyagait is tartalmazza", () => {
  // 120 g csont, 1000 bani / 1000 g → 120 bani / adag
  assert.equal(recipeCost(soup, ops().ingredients, [stockV1]), 120);
});

test("2. Az al-recept tejszín-allergénje az ételnél is megjelenik; az étel saját allergénje megmarad", () => {
  const cream = ingredient("cream", { unit: "ml", allergens: "milk" });
  const flour = ingredient("flour", { allergens: "gluten" });
  const sauce: PreparationVersion = {
    ...stockV1,
    id: "sauce-v1",
    preparationId: "sauce",
    output: 500,
    lines: [{ id: "x", versionId: "sauce-v1", ingredientId: "cream", quantity: 500, lossBps: 0 }],
  };
  const recipe: Recipe = {
    ...soup,
    id: "pasta-r1",
    productId: "pasta",
    yield: 4,
    lines: [{ id: "l", recipeId: "pasta-r1", ingredientId: "flour", quantity: 600, lossBps: 0 }],
    preparations: [{ id: "p", recipeId: "pasta-r1", preparationId: "sauce", quantity: 400, lossBps: 0 }],
  };
  const info = dishInfo(product("pasta", 250, "egg"), {
    ...emptyOperations,
    ingredients: [cream, flour],
    recipes: [recipe],
    preparations: [{ id: "sauce", hu: "Mártás", ro: "Sos", unit: "g", createdAt: "" }],
    preparationVersions: [sauce],
  });
  assert.ok(info);
  assert.deepEqual(info.allergens, ["egg", "gluten", "milk"]);
  assert.equal(ingredientText(info.ingredients, "hu"), "flour-hu, Mártás (cream-hu)");
});

test("3. 250 g × 100 kcal + 250 g × 60 kcal, 2 adag × 200 g → 100 kcal / 100 g", () => {
  const recipe: Recipe = {
    ...soup,
    id: "mix-r1",
    productId: "mix",
    yield: 2,
    lines: [
      { id: "a", recipeId: "mix-r1", ingredientId: "a", quantity: 250, lossBps: 0 },
      { id: "b", recipeId: "mix-r1", ingredientId: "b", quantity: 250, lossBps: 0 },
    ],
    preparations: [],
  };
  const info = dishInfo(product("mix", 200), {
    ...emptyOperations,
    ingredients: [
      ingredient("a", { nutrition: nutrition(100, { protein: 1000 }) }),
      ingredient("b", { nutrition: nutrition(60) }),
    ],
    recipes: [recipe],
  });
  assert.equal(info?.nutritionPer100g?.energyKcal, 10000);
  // 250 g × 10 g fehérje / 100 g = 25 g; 400 g késztermékben → 6,25 g / 100 g
  assert.equal(info?.nutritionPer100g?.protein, 625);
});

test("4. Tápérték nélküli alapanyag: nincs tápérték, az alapanyag a hiányzók között; darabnál a darabtömeg kell", () => {
  const recipe: Recipe = {
    ...soup,
    id: "e-r1",
    productId: "e",
    yield: 1,
    lines: [
      { id: "a", recipeId: "e-r1", ingredientId: "peas", quantity: 100, lossBps: 0 },
      { id: "b", recipeId: "e-r1", ingredientId: "egg", quantity: 2, lossBps: 0 },
    ],
    preparations: [],
  };
  const peas = ingredient("peas", { nutrition: "", frozen: 1 });
  const egg = ingredient("egg", { unit: "pcs", gramsPerPiece: null });
  const info = dishInfo(product("e", 200), { ...emptyOperations, ingredients: [peas, egg], recipes: [recipe] });
  assert.equal(info?.nutritionPer100g, null);
  assert.deepEqual(info?.missing.map((m) => m.ro), ["peas-ro", "egg-ro"]);
  assert.equal(ingredientText(info!.ingredients, "ro"), "peas-ro*, egg-ro");

  const withWeight = dishInfo(product("e", 200), {
    ...emptyOperations,
    ingredients: [{ ...peas, nutrition: nutrition(80) }, { ...egg, gramsPerPiece: 50 }],
    recipes: [recipe],
  });
  // (100 g × 80 + 100 g × 100) kcal / 100 → 180 kcal 200 g-ban → 90 kcal / 100 g
  assert.equal(withWeight?.nutritionPer100g?.energyKcal, 9000);
});

test("A tápérték-szöveg csak érvényes, nem negatív egész számokat fogad el", () => {
  assert.equal(parseNutrition(""), null);
  assert.equal(parseNutrition("{bad"), null);
  assert.equal(parseNutrition(JSON.stringify({ energyKj: -1 })), null);
  assert.equal(parseNutrition(nutrition(100))?.energyKcal, 10000);
});

test("A portálra kerülő ételinformáció nem tartalmaz mennyiséget, receptet vagy belső adatot", async () => {
  const { toPublicDishInfo } = await import("../src/modules/inventory/nutrition.ts");
  const recipe: Recipe = {
    ...soup,
    id: "pub-r1",
    productId: "pub",
    yield: 1,
    lines: [{ id: "l", recipeId: "pub-r1", ingredientId: "bones", quantity: 100, lossBps: 0 }],
  };
  const info = dishInfo(product("pub", 400, "celery"), ops({ recipes: [recipe] }));
  assert.ok(info);
  const pub = toPublicDishInfo(info);
  const text = JSON.stringify(pub);
  assert.ok(!text.includes("grams"));
  assert.ok(!text.includes("pub-r1"));
  assert.ok(!text.includes("stock-v1"));
  assert.deepEqual(Object.keys(pub).sort(), ["allergens", "complete", "ingredients", "nutritionPer100g"]);
  assert.equal(pub.complete, true);
  assert.equal(ingredientText(pub.ingredients, "hu"), "Alaplé (bones-hu), bones-hu");
  assert.equal(toPublicDishInfo({ ...info, missing: [{ hu: "x", ro: "x" }] }).complete, false);
});
