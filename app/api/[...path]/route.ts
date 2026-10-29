import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { products, customers, orders, orderItems, audit } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { nextState, today, type Order } from "@/src/modules/shared/domain";
import { demoProducts, demoCustomers } from "@/src/modules/shared/seed";
export const dynamic = "force-dynamic";
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
async function handle(req: Request, write: boolean) {
  try {
    const h = await headers();
    const actor = h.get("oai-authenticated-user-id");
    if (!actor) return json({ error: "AUTH_REQUIRED" }, 401);
    if (write) {
      if (req.headers.get("origin") !== new URL(req.url).origin)
        return json({ error: "INVALID_ORIGIN" }, 403);
      if (!req.headers.get("content-type")?.includes("application/json"))
        return json({ error: "JSON_REQUIRED" }, 415);
    }
    const db = getDb();
    const path = new URL(req.url).pathname;
    if (!write && path === "/api/data") {
      const [p, c, o, i, a] = await Promise.all([
        db.select().from(products),
        db.select().from(customers),
        db.select().from(orders),
        db.select().from(orderItems),
        db.select().from(audit).orderBy(desc(audit.createdAt)).limit(60),
      ]);
      return json({
        products: p,
        customers: c,
        orders: o.map((row) => ({
          ...row,
          items: i.filter((item) => item.orderId === row.id),
        })),
        audit: a,
      });
    }
    if (!write) return json({ error: "NOT_FOUND" }, 404);
    const raw = await req.text();
    if (raw.length > 40000) return json({ error: "TOO_LARGE" }, 413);
    const body = JSON.parse(raw);
    const now = new Date().toISOString();
    const log = (action: string, entity: string, detail: string) => ({
      id: crypto.randomUUID(),
      actor,
      action,
      entity,
      detail,
      createdAt: now,
    });
    if (path === "/api/demo") {
      const sample = [
        {
          id: "demo-o1",
          customer: demoCustomers[0],
          time: "11:30",
          production: "cooking",
          delivery: "pending",
          payment: "unpaid",
          lines: [
            [0, 18],
            [1, 18],
            [3, 12],
          ],
        },
        {
          id: "demo-o2",
          customer: demoCustomers[1],
          time: "12:00",
          production: "ready",
          delivery: "transit",
          payment: "paid",
          lines: [
            [0, 12],
            [2, 12],
          ],
        },
        {
          id: "demo-o3",
          customer: demoCustomers[2],
          time: "12:30",
          production: "queued",
          delivery: "pending",
          payment: "unpaid",
          lines: [
            [1, 8],
            [2, 6],
            [3, 8],
          ],
        },
      ];
      await db.batch([
        db.insert(audit).values(log("demo", "demo", "Sample data requested")),
        ...demoProducts.map((p) =>
          db.insert(products).values(p).onConflictDoNothing(),
        ),
        ...demoCustomers.map((c) =>
          db.insert(customers).values(c).onConflictDoNothing(),
        ),
        ...sample.map((o) =>
          db
            .insert(orders)
            .values({
              id: o.id,
              customerId: o.customer.id,
              customerName: o.customer.name,
              address: o.customer.address,
              phone: "",
              date: today(),
              time: o.time,
              note: "Mintaadat / Date demonstrative",
              production: o.production,
              delivery: o.delivery,
              payment: o.payment,
              status: "confirmed",
              revision: 0,
              createdAt: now,
            })
            .onConflictDoNothing(),
        ),
        ...sample.flatMap((o) =>
          o.lines.map(([pi, quantity]) => {
            const p = demoProducts[pi];
            return db
              .insert(orderItems)
              .values({
                id: o.id + "-" + p.id,
                orderId: o.id,
                productId: p.id,
                hu: p.hu,
                ro: p.ro,
                allergens: p.allergens,
                quantity,
                price: p.price,
              })
              .onConflictDoNothing();
          }),
        ),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/products") {
      const p = z
        .object({
          hu: text(),
          ro: text(),
          descriptionHu: z.string().max(1500),
          descriptionRo: z.string().max(1500),
          category: z.enum(["soup", "main", "vegetarian", "dessert"]),
          price: z.number().int().min(0).max(1000000),
          portion: z.number().int().min(1).max(10000),
          allergens: z.string().max(200),
        })
        .parse(body);
      const allowed = [
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
      if (
        p.allergens &&
        p.allergens.split(",").some((a) => !allowed.includes(a))
      )
        return json({ error: "VALIDATION" }, 400);
      const id = crypto.randomUUID();
      await db.batch([
        db.insert(products).values({ ...p, id, active: 1 }),
        db.insert(audit).values(log("product_created", id, p.hu)),
      ]);
      return json({ ok: true, id }, 201);
    }
    if (path === "/api/customers") {
      const c = z
        .object({
          name: text(),
          address: text(500),
          phone: z.string().trim().max(40),
          note: z.string().trim().max(1000),
        })
        .parse(body);
      const id = crypto.randomUUID();
      await db.batch([
        db.insert(customers).values({ ...c, id }),
        db.insert(audit).values(log("customer_created", id, c.name)),
      ]);
      return json({ ok: true, id }, 201);
    }
    if (path === "/api/orders") {
      const d = z
        .object({
          id: z.string().uuid(),
          customerId: text(),
          date,
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          note: z.string().max(1500),
          items: z
            .array(
              z.object({
                productId: text(),
                quantity: z.number().int().min(1).max(1000),
              }),
            )
            .min(1)
            .max(50),
        })
        .parse(body);
      const [existing] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, d.id));
      if (existing) return json({ ok: true, id: existing.id });
      const [c] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, d.customerId));
      if (!c) return json({ error: "CUSTOMER_MISSING" }, 400);
      const catalog = await db.select().from(products);
      const seen = new Set<string>();
      const items = d.items.map((i) => {
        const p = catalog.find((p) => p.id === i.productId && p.active);
        if (!p || seen.has(i.productId)) throw new Error("INVALID_ITEM");
        seen.add(i.productId);
        return {
          id: crypto.randomUUID(),
          orderId: d.id,
          productId: p.id,
          hu: p.hu,
          ro: p.ro,
          allergens: p.allergens,
          price: p.price,
          quantity: i.quantity,
        };
      });
      await db.batch([
        db
          .insert(orders)
          .values({
            id: d.id,
            customerId: c.id,
            customerName: c.name,
            address: c.address,
            phone: c.phone,
            date: d.date,
            time: d.time,
            note: d.note,
            production: "queued",
            delivery: "pending",
            payment: "unpaid",
            status: "confirmed",
            revision: 0,
            createdAt: now,
          }),
        ...items.map((i) => db.insert(orderItems).values(i)),
        db.insert(audit).values(log("order_created", d.id, c.name)),
      ]);
      return json({ ok: true, id: d.id }, 201);
    }
    if (path === "/api/orders/state") {
      const d = z
        .object({
          id: text(),
          revision: z.number().int().min(0),
          field: z.enum(["production", "delivery", "payment", "status"]),
          value: text(30),
        })
        .parse(body);
      const [row] = await db.select().from(orders).where(eq(orders.id, d.id));
      if (!row) return json({ error: "NOT_FOUND" }, 404);
      if (row.revision !== d.revision) return json({ error: "CONFLICT" }, 409);
      const updated = nextState(
        { ...row, items: [] } as Order,
        d.field,
        d.value,
      );
      const result = await env.DB!.batch([
        env
          .DB!.prepare(
            "INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=?)",
          )
          .bind(
            crypto.randomUUID(),
            actor,
            "state_changed",
            d.id,
            JSON.stringify({ field: d.field, from: row[d.field], to: d.value }),
            now,
            d.id,
            d.revision,
          ),
        env
          .DB!.prepare(
            `UPDATE orders SET ${d.field}=?,revision=? WHERE id=? AND revision=?`,
          )
          .bind(d.value, updated.revision, d.id, d.revision),
      ]);
      if (result[1].meta.changes !== 1) return json({ error: "CONFLICT" }, 409);
      return json({ ok: true });
    }
    return json({ error: "NOT_FOUND" }, 404);
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: "VALIDATION" }, 400);
    const code = e instanceof Error ? e.message : "";
    if (
      [
        "CANCELLED",
        "INVALID_TRANSITION",
        "NOT_READY",
        "ALREADY_STARTED",
        "INVALID_ITEM",
      ].includes(code)
    )
      return json({ error: code }, 400);
    console.error(e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
export const GET = (r: Request) => handle(r, false);
export const POST = (r: Request) => handle(r, true);
