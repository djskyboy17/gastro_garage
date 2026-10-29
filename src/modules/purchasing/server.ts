import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  suppliers,
  purchaseOrders,
  purchaseLines,
  purchaseEvents,
  ingredients,
  stockLots,
} from "@/db/schema";
import { today } from "../shared/domain";
import {
  purchaseTransition,
  type PurchasingData,
  type PurchaseOrder,
} from "./domain";
export class PurchaseError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const text = (max = 200) => z.string().trim().min(1).max(max);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const quantity = z.number().int().min(1).max(10000000);
export async function loadPurchasing(): Promise<PurchasingData> {
  const db = getDb();
  const [s, o, l, e] = await Promise.all([
    db.select().from(suppliers),
    db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)),
    db.select().from(purchaseLines),
    db
      .select()
      .from(purchaseEvents)
      .orderBy(desc(purchaseEvents.createdAt))
      .limit(200),
  ]);
  return {
    suppliers: s,
    orders: o.map((p) => ({
      ...p,
      lines: l.filter((line) => line.purchaseId === p.id),
    })),
    events: e,
  };
}
export async function handlePurchasing(
  path: string,
  body: unknown,
  actor: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/purchasing/")) return null;
  const db = getDb(),
    now = new Date().toISOString();
  const audit = (action: string, entity: string, detail: string) =>
    env
      .DB!.prepare(
        "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), actor, action, entity, detail, now);
  const guard = (
    id: string,
    revision: number,
    kind: string,
    detail: string,
    condition: string,
  ) =>
    env
      .DB!.prepare(
        `INSERT INTO purchase_events (id,purchase_id,kind,detail,actor,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM purchase_orders WHERE id=? AND revision=? AND ${condition}) THEN ? ELSE NULL END,?,?,?,?)`,
      )
      .bind(crypto.randomUUID(), id, revision, id, kind, detail, actor, now);
  const safeBatch = async (cmds: D1PreparedStatement[]) => {
    try {
      return await env.DB!.batch(cmds);
    } catch (e) {
      if (/CHECK|NOT NULL|UNIQUE|FOREIGN KEY/.test(String(e)))
        throw new PurchaseError("PURCHASE_CONFLICT", 409);
      throw e;
    }
  };
  if (path === "/api/purchasing/suppliers") {
    const d = z
      .object({
        id: z.string().uuid(),
        name: text(),
        taxId: z.string().trim().max(40),
        address: z.string().trim().max(500),
        email: z.union([z.string().trim().email().max(200), z.literal("")]),
        phone: z.string().trim().max(40),
        note: z.string().trim().max(1000),
      })
      .parse(body);
    const [old] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, d.id));
    if (old) return json({ ok: true, id: old.id });
    await safeBatch([
      env
        .DB!.prepare(
          "INSERT INTO suppliers (id,name,tax_id,address,email,phone,note) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(d.id, d.name, d.taxId, d.address, d.email, d.phone, d.note),
      audit("supplier_created", d.id, d.name),
    ]);
    return json({ ok: true, id: d.id }, 201);
  }
  if (path === "/api/purchasing/create" || path === "/api/purchasing/update") {
    const d = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int().min(0).optional(),
        supplierId: text(),
        due: date,
        note: z.string().trim().max(1000),
        lines: z
          .array(
            z.object({
              ingredientId: text(),
              quantity,
              packQuantity: quantity,
              packPrice: z.number().int().min(0).max(10000000),
            }),
          )
          .min(1)
          .max(25),
      })
      .parse(body);
    if (new Set(d.lines.map((l) => l.ingredientId)).size !== d.lines.length)
      throw new PurchaseError("INVALID_ITEM");
    const [old] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, d.id));
    if (path.endsWith("create") && old) return json({ ok: true, id: old.id });
    if (
      path.endsWith("update") &&
      (!old || old.status !== "draft" || old.revision !== d.revision)
    )
      throw new PurchaseError("PURCHASE_CONFLICT", 409);
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, d.supplierId));
    if (!supplier) throw new PurchaseError("SUPPLIER_MISSING");
    const known = await db.select().from(ingredients);
    if (d.lines.some((l) => !known.some((i) => i.id === l.ingredientId)))
      throw new PurchaseError("INVALID_ITEM");
    const header = old
      ? [
          guard(d.id, d.revision!, "updated", d.note, "status='draft'"),
          env
            .DB!.prepare("DELETE FROM purchase_lines WHERE purchase_id=?")
            .bind(d.id),
          env
            .DB!.prepare(
              "UPDATE purchase_orders SET supplier_id=?,supplier_name=?,supplier_tax_id=?,supplier_address=?,due=?,note=?,revision=revision+1 WHERE id=?",
            )
            .bind(
              supplier.id,
              supplier.name,
              supplier.taxId,
              supplier.address,
              d.due,
              d.note,
              d.id,
            ),
        ]
      : [
          env
            .DB!.prepare(
              "INSERT INTO purchase_orders (id,supplier_id,supplier_name,supplier_tax_id,supplier_address,due,note,status,revision,created_at) VALUES (?,?,?,?,?,?,?,'draft',0,?)",
            )
            .bind(
              d.id,
              supplier.id,
              supplier.name,
              supplier.taxId,
              supplier.address,
              d.due,
              d.note,
              now,
            ),
          env
            .DB!.prepare(
              "INSERT INTO purchase_events (id,purchase_id,kind,detail,actor,created_at) VALUES (?,?,?,?,?,?)",
            )
            .bind(crypto.randomUUID(), d.id, "created", d.note, actor, now),
        ];
    await safeBatch([
      ...header,
      ...d.lines.map((l) => {
        const i = known.find((i) => i.id === l.ingredientId)!;
        return env
          .DB!.prepare(
            "INSERT INTO purchase_lines (id,purchase_id,ingredient_id,hu,ro,unit,quantity,received,pack_quantity,pack_price) VALUES (?,?,?,?,?,?,?,0,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            d.id,
            i.id,
            i.hu,
            i.ro,
            i.unit,
            l.quantity,
            l.packQuantity,
            l.packPrice,
          );
      }),
      audit(old ? "purchase_updated" : "purchase_created", d.id, supplier.name),
    ]);
    return json({ ok: true, id: d.id }, old ? 200 : 201);
  }
  if (path === "/api/purchasing/state") {
    const d = z
      .object({
        id: text(),
        revision: z.number().int().min(0),
        action: z.enum(["confirm", "cancel", "close"]),
        note: z.string().trim().max(1000),
      })
      .parse(body);
    const data = await loadPurchasing(),
      p = data.orders.find((p) => p.id === d.id);
    if (!p) throw new PurchaseError("NOT_FOUND", 404);
    if (p.revision !== d.revision)
      throw new PurchaseError("PURCHASE_CONFLICT", 409);
    let status: string;
    try {
      status = purchaseTransition(p, d.action);
    } catch {
      throw new PurchaseError("PURCHASE_TRANSITION");
    }
    if (d.action === "close" && !d.note)
      throw new PurchaseError("CLOSE_NOTE_REQUIRED");
    await safeBatch([
      guard(d.id, d.revision, d.action, d.note, `status='${p.status}'`),
      env
        .DB!.prepare(
          "UPDATE purchase_orders SET status=?,revision=revision+1 WHERE id=?",
        )
        .bind(status, d.id),
      audit("purchase_" + d.action, d.id, d.note || p.supplierName),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/purchasing/receive") {
    const d = z
      .object({
        id: z.string().uuid(),
        purchaseId: text(),
        revision: z.number().int().min(0),
        lineId: text(),
        quantity,
        batch: text(),
        received: date,
        expires: date,
        totalCost: z.number().int().min(0).max(100000000),
        document: z.string().trim().max(200),
      })
      .parse(body);
    if (d.expires < d.received || d.received > today())
      throw new PurchaseError("INVALID_DATES");
    const [previous] = await db
      .select()
      .from(stockLots)
      .where(eq(stockLots.id, d.id));
    if (previous) {
      const [previousLine] = await db
        .select()
        .from(purchaseLines)
        .where(eq(purchaseLines.id, previous.purchaseLineId ?? ""));
      if (
        previousLine?.purchaseId !== d.purchaseId ||
        previous.purchaseLineId !== d.lineId ||
        previous.quantity !== d.quantity ||
        previous.batch !== d.batch ||
        previous.received !== d.received ||
        previous.expires !== d.expires ||
        previous.totalCost !== d.totalCost ||
        previous.document !== d.document
      )
        throw new PurchaseError("PURCHASE_CONFLICT", 409);
      return json({ ok: true, id: d.id });
    }
    const data = await loadPurchasing(),
      p = data.orders.find((p) => p.id === d.purchaseId);
    if (!p) throw new PurchaseError("NOT_FOUND", 404);
    if (p.revision !== d.revision)
      throw new PurchaseError("PURCHASE_CONFLICT", 409);
    if (p.status !== "ordered") throw new PurchaseError("PURCHASE_TRANSITION");
    const line = p.lines.find((l) => l.id === d.lineId);
    if (!line) throw new PurchaseError("INVALID_ITEM");
    if (d.quantity > line.quantity - line.received)
      throw new PurchaseError("OVER_RECEIPT");
    await safeBatch([
      guard(
        p.id,
        d.revision,
        "receipt",
        JSON.stringify({ lotId: d.id, lineId: d.lineId, quantity: d.quantity }),
        "status='ordered'",
      ),
      env
        .DB!.prepare(
          "UPDATE purchase_lines SET received=received+? WHERE id=? AND purchase_id=?",
        )
        .bind(d.quantity, d.lineId, p.id),
      env
        .DB!.prepare(
          "UPDATE purchase_orders SET revision=revision+1 WHERE id=?",
        )
        .bind(p.id),
      env
        .DB!.prepare(
          "INSERT INTO stock_lots (id,ingredient_id,batch,supplier,received,expires,quantity,remaining,total_cost,document,created_at,purchase_line_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          d.id,
          line.ingredientId,
          d.batch,
          p.supplierName,
          d.received,
          d.expires,
          d.quantity,
          d.quantity,
          d.totalCost,
          d.document,
          now,
          d.lineId,
        ),
      env
        .DB!.prepare(
          "INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,'received',?,?)",
        )
        .bind(crypto.randomUUID(), d.id, d.quantity, d.document, now),
      audit("purchase_received", p.id, line.hu + " · " + d.batch),
    ]);
    return json({ ok: true, id: d.id }, 201);
  }
  return json({ error: "NOT_FOUND" }, 404);
}
