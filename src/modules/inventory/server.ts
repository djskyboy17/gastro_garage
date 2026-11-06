import { env } from "cloudflare:workers";
import { eq, desc, gte, inArray } from "drizzle-orm";
import { allocateDocumentNumber, loadCompanyProfile } from "../documents/server";
import type { WriteOffContent } from "../production/finished";
import { z } from "zod";
import { getDb } from "@/db";
import {
  ingredients,
  recipes,
  recipeLines,
  stockLots,
  stockIssues,
  stockMoves,
  products,
  orders,
  orderItems,
  audit,
  preparations,
  preparationVersions,
  preparationLines,
  recipePreparationLines,
  productionBatches,
} from "@/db/schema";
import {
  allocate,
  requirements,
  latestRecipe,
  latestPreparation,
  emptyOperations,
  costFor,
  type OperationsData,
} from "./domain";
import {
  dishInfo,
  nutrientKeys,
  serializeNutrition,
  toPublicDishInfo,
  type Nutrition,
  type PublicDishInfo,
} from "./nutrition";
import type { Product } from "../shared/domain";
import { today, type Order } from "../shared/domain";
import { groupRows } from "../shared/collections";
import { sampleIngredients, sampleRecipes } from "./seed";
const addDaysIso = (date: string, days: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const text = (max = 200) => z.string().trim().min(1).max(max);
const qty = z.number().int().min(1).max(10000000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const allergenKeys = [
  "gluten",
  "crustaceans",
  "egg",
  "fish",
  "peanut",
  "soy",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
];
export class OperationError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export async function loadOperations(): Promise<OperationsData> {
  const db = getDb();
  const [i, r, l, lots, issues, moves, preps, versions, prepLines, recipePreps, batches] = await Promise.all([
    db.select().from(ingredients),
    db.select().from(recipes),
    db.select().from(recipeLines),
    db.select().from(stockLots),
    db.select().from(stockIssues),
    db.select().from(stockMoves).orderBy(desc(stockMoves.createdAt)).limit(200),
    db.select().from(preparations),
    db.select().from(preparationVersions),
    db.select().from(preparationLines),
    db.select().from(recipePreparationLines),
    db.select({ day: productionBatches.day, productId: productionBatches.productId, status: productionBatches.status }).from(productionBatches).where(gte(productionBatches.day, addDaysIso(today(), -14))),
  ]);
  const deferred = (await env.DB!.prepare("SELECT day,content FROM production_materials WHERE consumption_id IS NULL").all<{day:string;content:string}>()).results;
  const deferredNeeds = deferred.flatMap(row => {
    const snapshot=JSON.parse(row.content) as {needs:{ingredientId:string;quantity:number}[]};
    return snapshot.needs.map(line=>({day:row.day,ingredientId:line.ingredientId,quantity:line.quantity}));
  });
  const linesByRecipe = groupRows(l, line => line.recipeId);
  const prepsByRecipe = groupRows(recipePreps, line => line.recipeId);
  const linesByVersion = groupRows(prepLines, line => line.versionId);
  return {
    batches: batches as OperationsData["batches"],
    deferredNeeds,
    ingredients: i,
    recipes: r.map((recipe) => ({
      ...recipe,
      lines: linesByRecipe.get(recipe.id) ?? [],
      preparations: prepsByRecipe.get(recipe.id) ?? [],
    })),
    lots,
    issues,
    moves,
    preparations: preps,
    preparationVersions: versions.map((v) => ({
      ...v,
      lines: linesByVersion.get(v.id) ?? [],
    })),
  };
}
/** Csak a recept- és alapanyagadatok (készlet, mozgások nélkül) az ételinformációhoz. */
export async function loadRecipeData(): Promise<OperationsData> {
  const db = getDb();
  const [i, r, l, preps, versions, prepLines, recipePreps] = await Promise.all([
    db.select().from(ingredients),
    db.select().from(recipes),
    db.select().from(recipeLines),
    db.select().from(preparations),
    db.select().from(preparationVersions),
    db.select().from(preparationLines),
    db.select().from(recipePreparationLines),
  ]);
  const linesByRecipe = groupRows(l, line => line.recipeId);
  const prepsByRecipe = groupRows(recipePreps, line => line.recipeId);
  const linesByVersion = groupRows(prepLines, line => line.versionId);
  return {
    ...emptyOperations,
    ingredients: i,
    recipes: r.map((recipe) => ({
      ...recipe,
      lines: linesByRecipe.get(recipe.id) ?? [],
      preparations: prepsByRecipe.get(recipe.id) ?? [],
    })),
    preparations: preps,
    preparationVersions: versions.map((v) => ({ ...v, lines: linesByVersion.get(v.id) ?? [] })),
  };
}
/**
 * Nyilvános ételinformáció a megadott ételekhez (ANPC 201/2022: rendelés előtt elérhető).
 * Recept nélküli ételnél `null`.
 */
export async function publicDishInfos(productRows: Product[]): Promise<Map<string, PublicDishInfo | null>> {
  if (productRows.length === 0) return new Map();
  const ops = await loadRecipeData();
  return new Map(
    productRows.map((p) => {
      const info = dishInfo(p, ops);
      return [p.id, info ? toPublicDishInfo(info) : null];
    }),
  );
}
// Tápérték századokban (pl. 2,20 g → 220); a felület számol át.
const nutritionInput = z
  .object(
    Object.fromEntries(nutrientKeys.map((k) => [k, z.number().int().min(0).max(10000000)])) as Record<
      (typeof nutrientKeys)[number],
      z.ZodNumber
    >,
  )
  .nullable()
  .optional();
const splitAllergens = (s: string) => s.split(",").filter(Boolean);
function validAllergens(value: string) {
  return !value || splitAllergens(value).every((a) => allergenKeys.includes(a));
}
/**
 * Az ételek, amelyek legfrissebb receptje (közvetlenül vagy al-recepten át) a megadott
 * alapanyagot vagy al-receptet használja. Az allergének ezekhez csak hozzáadódnak.
 */
function affectedProducts(
  ops: OperationsData,
  source: { ingredientId?: string; preparationId?: string },
) {
  const productIds = [...new Set(ops.recipes.map((r) => r.productId))];
  return productIds.filter((productId) => {
    const r = latestRecipe(productId, ops.recipes);
    if (!r) return false;
    if (source.ingredientId && r.lines.some((l) => l.ingredientId === source.ingredientId)) return true;
    return (r.preparations ?? []).some((p) => {
      if (p.preparationId === source.preparationId) return true;
      const v = latestPreparation(p.preparationId, ops.preparationVersions);
      return !!source.ingredientId && !!v?.lines.some((l) => l.ingredientId === source.ingredientId);
    });
  });
}
function mergeAllergens(...lists: string[]) {
  return [...new Set(lists.flatMap(splitAllergens))].sort().join(",");
}
export async function handleOperations(
  path: string,
  body: unknown,
  actor: string,
  actorName = "",
): Promise<Response | null> {
  if (!path.startsWith("/api/operations/")) return null;
  const db = getDb(),
    now = new Date().toISOString();
  const log = (action: string, entity: string, detail: string) => ({
    id: crypto.randomUUID(),
    actor,
    action,
    entity,
    detail,
    createdAt: now,
  });
  if (path === "/api/operations/demo") {
    const catalog = await db.select().from(products);
    if (sampleRecipes.some((r) => !catalog.some((p) => p.id === r.productId)))
      throw new OperationError("DEMO_CATALOG_REQUIRED");
    const before = await loadOperations();
    const eligible = sampleRecipes.filter(
      (r) => !before.recipes.some((v) => v.productId === r.productId),
    );
    const expire = new Date(today() + "T12:00:00Z");
    expire.setUTCDate(expire.getUTCDate() + 7);
    const expires = expire.toISOString().slice(0, 10);
    await db.batch([
      db.insert(audit).values(log("inventory_demo", "demo", "Minta / Exemplu")),
      ...sampleIngredients.map((i) =>
        db.insert(ingredients).values(i).onConflictDoNothing(),
      ),
      ...eligible.map((r) =>
        db
          .insert(recipes)
          .values({
            id: "sample-recipe-" + r.productId,
            productId: r.productId,
            version: 1,
            yield: 10,
            note: "Egyszerűsített tesztrecept / Rețetă simplificată de test",
            createdAt: now,
          })
          .onConflictDoNothing(),
      ),
      ...eligible.flatMap((r) =>
        r.lines.map(([idx, quantity, lossBps]) =>
          db
            .insert(recipeLines)
            .values({
              id: "sample-line-" + r.productId + "-" + idx,
              recipeId: "sample-recipe-" + r.productId,
              ingredientId: sampleIngredients[idx].id,
              quantity,
              lossBps,
            })
            .onConflictDoNothing(),
        ),
      ),
      ...sampleIngredients
        .filter((i) => !before.lots.some((l) => l.id === "sample-lot-" + i.id))
        .flatMap((i) => {
          const quantity =
            i.unit === "pcs" ? 20 : i.id === "sample-chicken" ? 5000 : 2000;
          const id = "sample-lot-" + i.id;
          return [
            db
              .insert(stockLots)
              .values({
                id,
                ingredientId: i.id,
                batch: "DEMO-001",
                supplier: i.supplier,
                received: today(),
                expires,
                quantity,
                remaining: quantity,
                totalCost: Math.ceil((quantity * i.packPrice) / i.packQuantity),
                document: "DEMO",
                createdAt: now,
              })
              .onConflictDoNothing(),
            db
              .insert(stockMoves)
              .values({
                id: "sample-move-" + i.id,
                lotId: id,
                issueId: null,
                quantity,
                kind: "received",
                note: "Minta / Exemplu",
                createdAt: now,
              })
              .onConflictDoNothing(),
          ];
        }),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/operations/ingredients") {
    const i = z
      .object({
        hu: text(),
        ro: text(),
        unit: z.enum(["g", "ml", "pcs"]),
        packQuantity: qty,
        packPrice: z.number().int().min(0).max(10000000),
        minStock: z.number().int().min(0).max(10000000),
        supplier: z.string().trim().max(200),
        allergens: z.string().max(200),
        nutrition: nutritionInput,
        frozen: z.boolean().optional(),
        gramsPerPiece: z.number().int().min(1).max(100000).nullable().optional(),
      })
      .parse(body);
    if (!validAllergens(i.allergens)) throw new OperationError("VALIDATION");
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(ingredients).values({
        ...i,
        id,
        nutrition: serializeNutrition((i.nutrition as Nutrition | null | undefined) ?? null),
        frozen: i.frozen ? 1 : 0,
        gramsPerPiece: i.unit === "pcs" ? (i.gramsPerPiece ?? null) : null,
      }),
      db.insert(audit).values(log("ingredient_created", id, i.hu)),
    ]);
    return json({ ok: true, id }, 201);
  }
  if (path === "/api/operations/ingredient-details") {
    const d = z
      .object({
        id: text(),
        allergens: z.string().max(200),
        nutrition: nutritionInput,
        frozen: z.boolean(),
        gramsPerPiece: z.number().int().min(1).max(100000).nullable(),
      })
      .parse(body);
    if (!validAllergens(d.allergens)) throw new OperationError("VALIDATION");
    const [existing] = await db.select().from(ingredients).where(eq(ingredients.id, d.id));
    if (!existing) throw new OperationError("INVALID_ITEM");
    const ops = await loadOperations();
    // Új allergén: az érintett ételekhez hozzáadódik; eltávolítás az ételeket nem érinti.
    const added = splitAllergens(d.allergens).filter((a) => !splitAllergens(existing.allergens).includes(a));
    const productRows = added.length ? await db.select().from(products) : [];
    const updates = affectedProducts(ops, { ingredientId: d.id }).flatMap((productId) => {
      const p = productRows.find((p) => p.id === productId);
      return p
        ? [db.update(products).set({ allergens: mergeAllergens(p.allergens, added.join(",")) }).where(eq(products.id, productId))]
        : [];
    });
    await db.batch([
      db
        .update(ingredients)
        .set({
          allergens: d.allergens,
          nutrition: serializeNutrition((d.nutrition as Nutrition | null | undefined) ?? null),
          frozen: d.frozen ? 1 : 0,
          gramsPerPiece: existing.unit === "pcs" ? d.gramsPerPiece : null,
        })
        .where(eq(ingredients.id, d.id)),
      ...updates,
      db.insert(audit).values(log("ingredient_details_updated", d.id, existing.hu)),
    ]);
    return json({ ok: true, id: d.id });
  }
  if (path === "/api/operations/preparations") {
    const d = z
      .object({
        preparationId: z.string().trim().max(200).optional(),
        hu: z.string().trim().max(200).optional(),
        ro: z.string().trim().max(200).optional(),
        unit: z.enum(["g", "ml"]).optional(),
        output: qty,
        note: z.string().trim().max(1000),
        lines: z
          .array(z.object({ ingredientId: text(), quantity: qty, lossBps: z.number().int().min(0).max(9000) }))
          .min(1)
          .max(25),
      })
      .parse(body);
    if (new Set(d.lines.map((l) => l.ingredientId)).size !== d.lines.length) throw new OperationError("INVALID_ITEM");
    const known = await db.select().from(ingredients);
    if (d.lines.some((l) => !known.some((i) => i.id === l.ingredientId))) throw new OperationError("INVALID_ITEM");

    let preparationId = d.preparationId;
    let label = "";
    const commands = [];
    if (preparationId) {
      const [prep] = await db.select().from(preparations).where(eq(preparations.id, preparationId));
      if (!prep) throw new OperationError("INVALID_ITEM");
      label = prep.hu;
    } else {
      if (!d.hu || !d.ro || !d.unit) throw new OperationError("VALIDATION");
      preparationId = crypto.randomUUID();
      label = d.hu;
      commands.push(db.insert(preparations).values({ id: preparationId, hu: d.hu, ro: d.ro, unit: d.unit, createdAt: now }));
    }
    const existing = await db.select().from(preparationVersions).where(eq(preparationVersions.preparationId, preparationId));
    const version = Math.max(0, ...existing.map((v) => v.version)) + 1;
    const versionId = crypto.randomUUID();
    commands.push(
      db.insert(preparationVersions).values({ id: versionId, preparationId, version, output: d.output, note: d.note, createdAt: now }),
      ...d.lines.map((l) => db.insert(preparationLines).values({ ...l, id: crypto.randomUUID(), versionId })),
    );
    // Az al-recept alapanyagainak allergénjei az azt használó ételekhez hozzáadódnak.
    const ops = await loadOperations();
    const prepAllergens = mergeAllergens(...d.lines.map((l) => known.find((i) => i.id === l.ingredientId)!.allergens));
    if (prepAllergens) {
      const productRows = await db.select().from(products);
      for (const productId of affectedProducts(ops, { preparationId })) {
        const p = productRows.find((p) => p.id === productId);
        if (p) commands.push(db.update(products).set({ allergens: mergeAllergens(p.allergens, prepAllergens) }).where(eq(products.id, productId)));
      }
    }
    commands.push(db.insert(audit).values(log("preparation_version_created", versionId, label + " · v" + version)));
    try {
      await db.batch(commands as unknown as Parameters<typeof db.batch>[0]);
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new OperationError("CONFLICT", 409);
      throw e;
    }
    return json({ ok: true, id: preparationId, versionId }, 201);
  }
  if (path === "/api/operations/recipes") {
    const d = z
      .object({
        productId: text(),
        yield: z.number().int().min(1).max(1000),
        note: z.string().trim().max(1000),
        lines: z
          .array(
            z.object({
              ingredientId: text(),
              quantity: qty,
              lossBps: z.number().int().min(0).max(9000),
            }),
          )
          .max(25),
        preparations: z
          .array(
            z.object({
              preparationId: text(),
              quantity: qty,
              lossBps: z.number().int().min(0).max(9000),
            }),
          )
          .max(25)
          .default([]),
      })
      .parse(body);
    if (d.lines.length + d.preparations.length === 0) throw new OperationError("VALIDATION");
    if (new Set(d.lines.map((l) => l.ingredientId)).size !== d.lines.length)
      throw new OperationError("INVALID_ITEM");
    if (new Set(d.preparations.map((l) => l.preparationId)).size !== d.preparations.length)
      throw new OperationError("INVALID_ITEM");
    const opsBefore = await loadOperations();
    const prepVersions = d.preparations.map((l) => latestPreparation(l.preparationId, opsBefore.preparationVersions));
    if (prepVersions.some((v) => !v)) throw new OperationError("INVALID_ITEM");
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, d.productId));
    if (!product) throw new OperationError("INVALID_ITEM");
    const known = await db.select().from(ingredients);
    if (d.lines.some((l) => !known.some((i) => i.id === l.ingredientId)))
      throw new OperationError("INVALID_ITEM");
    const existing = await db
      .select()
      .from(recipes)
      .where(eq(recipes.productId, d.productId));
    const version = Math.max(0, ...existing.map((r) => r.version)) + 1;
    const id = crypto.randomUUID();
    const allergens = [
      ...new Set(
        [
          ...product.allergens.split(","),
          ...d.lines.flatMap((l) =>
            known.find((i) => i.id === l.ingredientId)!.allergens.split(","),
          ),
          ...prepVersions.flatMap((v) =>
            v!.lines.flatMap((l) => known.find((i) => i.id === l.ingredientId)?.allergens.split(",") ?? []),
          ),
        ].filter(Boolean),
      ),
    ]
      .sort()
      .join(",");
    try {
      await db.batch([
        db
          .insert(recipes)
          .values({
            id,
            productId: d.productId,
            version,
            yield: d.yield,
            note: d.note,
            createdAt: now,
          }),
        ...d.lines.map((l) =>
          db
            .insert(recipeLines)
            .values({ ...l, id: crypto.randomUUID(), recipeId: id }),
        ),
        ...d.preparations.map((l) =>
          db
            .insert(recipePreparationLines)
            .values({ ...l, id: crypto.randomUUID(), recipeId: id }),
        ),
        db
          .update(products)
          .set({ allergens })
          .where(eq(products.id, d.productId)),
        db
          .insert(audit)
          .values(log("recipe_created", id, product.hu + " · v" + version)),
      ]);
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        throw new OperationError("CONFLICT", 409);
      throw e;
    }
    return json({ ok: true, id }, 201);
  }
  if (path === "/api/operations/receive") {
    const d = z
      .object({
        id: z.string().uuid(),
        ingredientId: text(),
        batch: text(),
        supplier: text(),
        received: date,
        expires: date,
        quantity: qty,
        totalCost: z.number().int().min(0).max(100000000),
        document: z.string().trim().max(200),
      })
      .parse(body);
    if (d.expires < d.received || d.received > today())
      throw new OperationError("INVALID_DATES");
    const [existing] = await db
      .select()
      .from(stockLots)
      .where(eq(stockLots.id, d.id));
    if (existing) return json({ ok: true, id: existing.id });
    const [ingredient] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, d.ingredientId));
    if (!ingredient) throw new OperationError("INVALID_ITEM");
    await db.batch([
      db
        .insert(stockLots)
        .values({ ...d, remaining: d.quantity, createdAt: now }),
      db
        .insert(stockMoves)
        .values({
          id: crypto.randomUUID(),
          lotId: d.id,
          issueId: null,
          quantity: d.quantity,
          kind: "received",
          note: d.document,
          createdAt: now,
        }),
      db
        .insert(audit)
        .values(log("stock_received", d.id, ingredient.hu + " · " + d.batch)),
    ]);
    return json({ ok: true, id: d.id }, 201);
  }
  // v100: több raktári tétel selejtezése egy lépésben, PV-vel (PVC sorozat, production_documents write_off, kind: materials).
  if (path === "/api/operations/write-off") {
    const d = z.object({ id: z.string().uuid(), reason: text(300), lines: z.array(z.object({ lotId: text(), quantity: qty })).min(1).max(100) }).parse(body);
    const DB = env.DB!;
    if (await DB.prepare("SELECT id FROM production_documents WHERE id=?").bind(d.id).first()) return json({ ok: true, id: d.id });
    const lotRows = await db.select().from(stockLots).where(inArray(stockLots.id, d.lines.map((l) => l.lotId)));
    const ingRows = await db.select().from(ingredients).where(inArray(ingredients.id, lotRows.map((l) => l.ingredientId)));
    const lines = d.lines.map((l) => {
      const lot = lotRows.find((x) => x.id === l.lotId);
      if (!lot) throw new OperationError("INVALID_ITEM");
      if (lot.remaining < l.quantity) throw new OperationError("INSUFFICIENT_STOCK");
      const ing = ingRows.find((x) => x.id === lot.ingredientId);
      return { productId: lot.ingredientId, ro: ing?.ro ?? "", hu: ing?.hu ?? "", code: lot.batch, batchDay: lot.expires, quantity: l.quantity, unit: ing?.unit ?? "g", reason: d.reason, value: costFor(l.quantity, lot.totalCost, lot.quantity) };
    });
    const settings = await DB.prepare("SELECT write_off_committee AS c FROM production_settings WHERE id=1").first<{ c: string }>();
    const issueDate = today();
    const content: WriteOffContent = {
      day: issueDate,
      kind: "materials",
      company: (await loadCompanyProfile()).name,
      committee: (settings?.c ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean),
      lines,
      totalValue: lines.reduce((s, l) => s + l.value, 0),
      ...(actorName ? { signer: { name: actorName, at: now } } : {}),
    };
    const doc = allocateDocumentNumber("write_off", issueDate, now);
    const statements: D1PreparedStatement[] = [...doc.statements];
    for (const l of d.lines) {
      // Ha közben elfogyott a tétel, a napló szereplője NULL lesz, és az egész köteg visszagörgetődik.
      statements.push(
        DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN (SELECT remaining FROM stock_lots WHERE id=?)>=? THEN ? ELSE NULL END,'stock_write_off',?,?,?)").bind(crypto.randomUUID(), l.lotId, l.quantity, actor, l.lotId, JSON.stringify({ quantity: l.quantity, reason: d.reason, pv: d.id }), now),
        DB.prepare("UPDATE stock_lots SET remaining=remaining-? WHERE id=?").bind(l.quantity, l.lotId),
        DB.prepare("INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,'waste',?,?)").bind(crypto.randomUUID(), l.lotId, -l.quantity, "PV: " + d.reason, now),
      );
    }
    statements.push(
      DB.prepare(`INSERT INTO production_documents (id,doc_type,year,number,kind,status,reversal_of,reversed_by,issue_date,day,batch_id,content,created_by,created_at) VALUES (?,'write_off',?,${doc.numberSql},'issue','issued',NULL,NULL,?,?,NULL,?,?,?)`).bind(d.id, doc.year, ...doc.numberBinds, issueDate, issueDate, JSON.stringify(content), actor, now),
    );
    try {
      await DB.batch(statements);
    } catch (e) {
      if (/NOT NULL/i.test(String(e))) throw new OperationError("INSUFFICIENT_STOCK");
      throw e;
    }
    return json({ ok: true, id: d.id });
  }
  if (path === "/api/operations/waste") {
    const d = z
      .object({
        id: z.string().uuid(),
        lotId: text(),
        quantity: qty,
        note: text(1000),
      })
      .parse(body);
    const [existing] = await db
      .select()
      .from(stockMoves)
      .where(eq(stockMoves.id, d.id));
    if (existing) return json({ ok: true });
    const [lot] = await db
      .select()
      .from(stockLots)
      .where(eq(stockLots.id, d.lotId));
    if (!lot) throw new OperationError("INVALID_ITEM");
    if (lot.remaining < d.quantity)
      throw new OperationError("INSUFFICIENT_STOCK");
    try {
      await env.DB!.batch([
        env
          .DB!.prepare("UPDATE stock_lots SET remaining=remaining-? WHERE id=?")
          .bind(d.quantity, d.lotId),
        env
          .DB!.prepare(
            "INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,?,?,?)",
          )
          .bind(d.id, d.lotId, -d.quantity, "waste", d.note, now),
        env
          .DB!.prepare(
            "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            actor,
            "stock_waste",
            d.lotId,
            d.note,
            now,
          ),
      ]);
    } catch (e) {
      if (String(e).includes("CHECK") || String(e).includes("UNIQUE"))
        throw new OperationError("STOCK_CONFLICT", 409);
      throw e;
    }
    return json({ ok: true });
  }
  // Historical stock_issues remain readable. New production is posted only by the daily close.
  if (path === "/api/operations/issue") return json({ error: "USE_DAILY_MATERIALS" }, 410);
  return json({ error: "NOT_FOUND" }, 404);
}
