import { env } from "cloudflare:workers";
import { eq, desc } from "drizzle-orm";
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
} from "@/db/schema";
import {
  allocate,
  requirements,
  latestRecipe,
  type OperationsData,
} from "./domain";
import { today, type Order } from "../shared/domain";
import { sampleIngredients, sampleRecipes } from "./seed";
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
  const [i, r, l, lots, issues, moves] = await Promise.all([
    db.select().from(ingredients),
    db.select().from(recipes),
    db.select().from(recipeLines),
    db.select().from(stockLots),
    db.select().from(stockIssues),
    db.select().from(stockMoves).orderBy(desc(stockMoves.createdAt)).limit(200),
  ]);
  return {
    ingredients: i,
    recipes: r.map((recipe) => ({
      ...recipe,
      lines: l.filter((line) => line.recipeId === recipe.id),
    })),
    lots,
    issues,
    moves,
  };
}
export async function handleOperations(
  path: string,
  body: unknown,
  actor: string,
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
      })
      .parse(body);
    if (
      i.allergens &&
      i.allergens.split(",").some((a) => !allergenKeys.includes(a))
    )
      throw new OperationError("VALIDATION");
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(ingredients).values({ ...i, id }),
      db.insert(audit).values(log("ingredient_created", id, i.hu)),
    ]);
    return json({ ok: true, id }, 201);
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
          .min(1)
          .max(25),
      })
      .parse(body);
    if (new Set(d.lines.map((l) => l.ingredientId)).size !== d.lines.length)
      throw new OperationError("INVALID_ITEM");
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
  if (path === "/api/operations/issue") {
    const d = z
      .object({
        orderId: text(),
        revision: z.number().int().min(0),
        recipeIds: z.array(text()).min(1).max(50),
        note: z.string().trim().max(1000),
        actual: z
          .array(z.object({ ingredientId: text(), quantity: qty }))
          .min(1)
          .max(50),
      })
      .parse(body);
    const [existing] = await db
      .select()
      .from(stockIssues)
      .where(eq(stockIssues.orderId, d.orderId));
    if (existing) return json({ ok: true, id: existing.id });
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, d.orderId));
    if (!row) throw new OperationError("NOT_FOUND", 404);
    if (row.revision !== d.revision) throw new OperationError("CONFLICT", 409);
    if (
      row.status === "cancelled" ||
      !["queued", "cooking"].includes(row.production) ||
      row.delivery !== "pending"
    )
      throw new OperationError("ISSUE_STATE");
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, d.orderId));
    const ops = await loadOperations();
    const req = requirements({ ...row, items } as Order, ops.recipes);
    if (req.missing.length) throw new OperationError("MISSING_RECIPE");
    if (
      JSON.stringify([...d.recipeIds].sort()) !==
      JSON.stringify([...req.recipeIds].sort())
    )
      throw new OperationError("CONFLICT", 409);
    const actual = new Map(d.actual.map((i) => [i.ingredientId, i.quantity]));
    if (
      actual.size !== d.actual.length ||
      actual.size !== req.needs.size ||
      [...actual.keys()].some((k) => !req.needs.has(k))
    )
      throw new OperationError("INVALID_ITEM");
    if ([...actual].some(([key, v]) => req.needs.get(key) !== v) && !d.note)
      throw new OperationError("ACTUAL_NOTE_REQUIRED");
    const allocation = allocate(actual, ops.lots, today());
    if (allocation.shortage.length)
      throw new OperationError("INSUFFICIENT_STOCK");
    if (allocation.allocations.length > 35)
      throw new OperationError("TOO_MANY_LOTS");
    const id = crypto.randomUUID();
    const snapshot = JSON.stringify({
      recipes: req.recipeIds,
      planned: Object.fromEntries(req.needs),
      actual: Object.fromEntries(actual),
      note: d.note,
    });
    const commands = [
      env
        .DB!.prepare(
          "INSERT INTO stock_issues (id,order_id,recipe_snapshot,created_at,actor) VALUES (?,?,CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status='confirmed' AND production IN ('queued','cooking') AND delivery='pending') THEN ? ELSE NULL END,?,?)",
        )
        .bind(id, d.orderId, d.orderId, d.revision, snapshot, now, actor),
      env
        .DB!.prepare(
          "UPDATE orders SET production='cooking',revision=revision+1 WHERE id=? AND revision=?",
        )
        .bind(d.orderId, d.revision),
      ...allocation.allocations.flatMap((a) => [
        env
          .DB!.prepare("UPDATE stock_lots SET remaining=remaining-? WHERE id=?")
          .bind(a.quantity, a.lotId),
        env
          .DB!.prepare(
            "INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            a.lotId,
            id,
            -a.quantity,
            "issued",
            d.orderId,
            now,
          ),
      ]),
      env
        .DB!.prepare(
          "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          actor,
          "stock_issued",
          d.orderId,
          row.customerName,
          now,
        ),
    ];
    try {
      await env.DB!.batch(commands);
    } catch (e) {
      if (/CHECK|UNIQUE|NOT NULL/.test(String(e)))
        throw new OperationError("STOCK_CONFLICT", 409);
      throw e;
    }
    return json({ ok: true, id }, 201);
  }
  return json({ error: "NOT_FOUND" }, 404);
}
