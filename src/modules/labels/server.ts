import { env } from "cloudflare:workers";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { labelSettings, orderItems, orders, productLabels, products } from "@/db/schema";
import type { Session } from "../access/domain";
import { isAdmin } from "../access/domain";
import { orderCode, today } from "../shared/domain";
import { validDay } from "../menu/domain";
import { needsPacking } from "../packing/domain";
import { loadRecipeData } from "../inventory/server";
import { latestRecipe } from "../inventory/domain";
import { recipeInfo } from "../inventory/nutrition";
import type { Product } from "../shared/domain";
import {
  addDays,
  consumerLabel,
  parseLabelSettings,
  SHELF_LIFE_MAX,
  toPublicLabel,
  type ConsumerLabel,
  type LabelSettings,
} from "./domain";

export class LabelError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const line = (max: number) => z.string().trim().max(max);

async function loadSettings(): Promise<{ revision: number; settings: LabelSettings }> {
  const [row] = await getDb().select().from(labelSettings).where(eq(labelSettings.id, 1));
  return { revision: row?.revision ?? 0, settings: parseLabelSettings(row?.content) };
}
/** A QR-kód a portál címére mutat (ha be van állítva), különben arra, ahonnan a címkét nyomtatják. */
function baseUrl(req: Request) {
  const host = (env as { PORTAL_HOST?: string }).PORTAL_HOST;
  return host ? `https://${host}` : new URL(req.url).origin;
}

/** Címkék a megadott tételekhez; a recept a rendeléskor mentett változat (ha nincs, a legfrissebb). */
async function buildLabels(
  rows: { item: typeof orderItems.$inferSelect; order: typeof orders.$inferSelect }[],
  req: Request,
): Promise<ConsumerLabel[]> {
  if (!rows.length) return [];
  const db = getDb();
  const productIds = [...new Set(rows.map((r) => r.item.productId))];
  const [productRows, labelRows, { settings }, ops] = await Promise.all([
    db.select().from(products).where(inArray(products.id, productIds)),
    db.select().from(productLabels).where(inArray(productLabels.productId, productIds)),
    loadSettings(),
    loadRecipeData(),
  ]);
  const base = baseUrl(req);
  return rows.map(({ item, order }) => {
    const product = productRows.find((p) => p.id === item.productId) as Product | undefined;
    const recipe =
      (item.recipeId && ops.recipes.find((r) => r.id === item.recipeId)) || latestRecipe(item.productId, ops.recipes);
    const info = product && recipe ? recipeInfo(product, recipe, ops) : null;
    return consumerLabel({
      item,
      orderCode: orderCode(order.id),
      date: order.date,
      netGrams: product?.portion ?? 0,
      info,
      label: labelRows.find((l) => l.productId === item.productId) ?? null,
      settings,
      baseUrl: base,
    });
  });
}

/** Nyilvános: a címke QR-kódja ezt nyitja meg. Csak visszaigazolt rendelés tétele, ügyféladat nélkül. */
export async function publicLabel(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id || id.length > 200) return json({ error: "NOT_FOUND" }, 404);
  const rows = await getDb()
    .select({ item: orderItems, order: orders })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.id, id), eq(orders.status, "confirmed")));
  const [label] = await buildLabels(rows, req);
  if (!label) return json({ error: "NOT_FOUND" }, 404);
  return json(toPublicLabel(label));
}

const settingsInput = z
  .object({
    revision: z.number().int().min(0),
    settings: z
      .object({
        producerName: line(200),
        producerAddress: line(300),
        producerExtra: line(200),
        defaultStorageRo: line(300),
        defaultStorageHu: line(300),
      })
      .strict(),
    products: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(200),
            shelfLifeDays: z.number().int().min(0).max(SHELF_LIFE_MAX).nullable(),
            storageRo: line(300),
            storageHu: line(300),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export async function handleLabels(path: string, body: unknown, session: Session, write: boolean, req: Request) {
  const db = getDb();
  if (!write && path === "/api/labels") {
    if (!["owner", "admin", "kitchen", "warehouse", "dispatcher"].includes(session.role)) throw new LabelError("FORBIDDEN", 403);
    const params = new URL(req.url).searchParams;
    const date = params.get("date") ?? today(),
      orderId = params.get("orderId") ?? "";
    if (!validDay(date) || date < addDays(today(), -90) || date > addDays(today(), 90)) throw new LabelError("PACKING_DATE");
    const rows = await db
      .select({ item: orderItems, order: orders })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.date, date), eq(orders.status, "confirmed"), ...(orderId ? [eq(orders.id, orderId)] : [])))
      .orderBy(asc(orders.time), asc(orders.id), asc(orderItems.id));
    return json({ date, labels: await buildLabels(rows.filter((r) => needsPacking(r.order)), req) });
  }
  if (!isAdmin(session.role)) throw new LabelError("FORBIDDEN", 403);
  if (!write && path === "/api/labels/settings") {
    const [{ revision, settings }, productRows, labelRows] = await Promise.all([
      loadSettings(),
      db.select().from(products).where(eq(products.active, 1)).orderBy(asc(products.hu)),
      db.select().from(productLabels),
    ]);
    return json({
      revision,
      settings,
      products: productRows.map((p) => {
        const l = labelRows.find((r) => r.productId === p.id);
        return { productId: p.id, hu: p.hu, ro: p.ro, shelfLifeDays: l?.shelfLifeDays ?? null, storageRo: l?.storageRo ?? "", storageHu: l?.storageHu ?? "" };
      }),
    });
  }
  if (!write || path !== "/api/labels/settings") return json({ error: "NOT_FOUND" }, 404);
  const d = settingsInput.parse(body);
  if (new Set(d.products.map((p) => p.productId)).size !== d.products.length) throw new LabelError("VALIDATION");
  if (d.products.length) {
    const known = await db.select({ id: products.id }).from(products).where(inArray(products.id, d.products.map((p) => p.productId)));
    if (known.length !== d.products.length) throw new LabelError("VALIDATION");
  }
  const now = new Date().toISOString();
  const DB = env.DB!;
  // Az első utasítás NULL szereplővel elbukik, ha közben más mentett: ilyenkor az egész köteg visszagörgetődik.
  await DB.batch([
    DB.prepare(
      "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN COALESCE((SELECT revision FROM label_settings WHERE id=1),0)=? THEN ? ELSE NULL END,'label_settings_saved','label_settings',?,?)",
    ).bind(crypto.randomUUID(), d.revision, session.userId, JSON.stringify({ products: d.products.length }), now),
    DB.prepare(
      "INSERT INTO label_settings (id,revision,content) VALUES (1,1,?) ON CONFLICT(id) DO UPDATE SET revision=label_settings.revision+1,content=excluded.content",
    ).bind(JSON.stringify(d.settings)),
    ...d.products.map((p) =>
      p.shelfLifeDays === null
        ? DB.prepare("DELETE FROM product_labels WHERE product_id=?").bind(p.productId)
        : DB.prepare(
            "INSERT INTO product_labels (product_id,shelf_life_days,storage_ro,storage_hu,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET shelf_life_days=excluded.shelf_life_days,storage_ro=excluded.storage_ro,storage_hu=excluded.storage_hu,updated_at=excluded.updated_at",
          ).bind(p.productId, p.shelfLifeDays, p.storageRo, p.storageHu, now),
    ),
  ]).catch((e: Error) => {
    if (/NOT NULL/i.test(e.message)) throw new LabelError("CONFLICT", 409);
    throw e;
  });
  return json({ ok: true });
}
