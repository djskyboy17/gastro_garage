import {handlePacking,PackingError} from "@/src/modules/packing/server";
import {handleLabels,publicLabel,LabelError} from "@/src/modules/labels/server";
import {handleKitchen,KitchenError} from "@/src/modules/kitchen/server";
import {serveProductImage,handleProductImage,ImageError} from "@/src/modules/images/server";
import {handleCourier,CourierError} from "@/src/modules/courier/server";
import {fulfillmentOptions,loadPolicy,savePolicy,FulfillmentError} from '@/src/modules/fulfillment/server';
import {loadStocktakes,handleStocktake,StocktakeError} from '@/src/modules/stocktake/server';
import {loadMenu,publicMenu,publicMenuBoard,saveMenu,saveMenuSettings,MenuError} from '@/src/modules/menu/server';
import {handleInvoices,InvoiceError} from "@/src/modules/invoices/server";
import {handleProduction,ProductionError} from "@/src/modules/production/server";
import {handleDeliveryNotes,DeliveryNoteError,hasActiveNote,cancelOrderWithNote} from "@/src/modules/delivery-notes/server";
import {handleFinance,FinanceError,cancelPaymentState} from "@/src/modules/finance/server";
import { env } from "cloudflare:workers";
import { currentUser, handleAuth, AuthError } from "@/src/modules/auth/server";
import { sessionFor, handleAccess, loadMembers, AccessError } from "@/src/modules/access/server";
import { isMember, isAdmin, isKitchenStaff, canWrite, projectData } from "@/src/modules/access/domain";
import { getDb } from "@/db";
import { loadPublicCatalog, handlePortal, PortalError } from "@/src/modules/portal/server";
import { loadRecurring, handleRecurring, RecurringError } from "@/src/modules/recurring/server";
import { loadSafety, handleSafety, SafetyError } from "@/src/modules/safety/server";
import { products, customers, orders, orderItems, audit, workspaceOwners, recipes } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { nextState, today, CATEGORIES, DAILY_CATEGORIES, SECTIONS, type Order } from "@/src/modules/shared/domain";
import { hardDeleteOrder } from "@/src/modules/shared/order-delete";
import { demoProducts, demoCustomers } from "@/src/modules/shared/seed";
import {
  loadOperations,
  handleOperations,
  OperationError,
} from "@/src/modules/inventory/server";
import { latestRecipe, emptyOperations } from "@/src/modules/inventory/domain";
import { groupRows } from "@/src/modules/shared/collections";
import { loadDelivery, handleDelivery, courierUserName, DeliveryError } from "@/src/modules/delivery/server";
import {
  loadPurchasing,
  handlePurchasing,
  PurchaseError,
} from "@/src/modules/purchasing/server";
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
    const path = new URL(req.url).pathname;
    if (!write && path === "/api/portal/fulfillment") return json(await fulfillmentOptions(new URL(req.url).searchParams.get("date")??today()));
    if (!write && path === "/api/portal/menu") return json(await publicMenu(new URL(req.url).searchParams.get("date")??today()));
    if (!write && path === "/api/portal/menu-board") return json(await publicMenuBoard(new URL(req.url).searchParams.get("date")??today()));
    if (!write && path === "/api/portal/catalog") return json(await loadPublicCatalog());
    if (!write && path === "/api/public/label") return await publicLabel(req);
    if (!write && path === "/api/products/image") return await serveProductImage(req, async () => {
      const u = await currentUser(req);
      return !!u && isMember((await sessionFor(u)).role);
    });
    if (path.startsWith("/api/auth/")) {
      let authBody: unknown;
      if (write) {
        if (req.headers.get("origin") !== new URL(req.url).origin) return json({ error: "INVALID_ORIGIN" }, 403);
        if (!req.headers.get("content-type")?.includes("application/json")) return json({ error: "JSON_REQUIRED" }, 415);
        const raw = await req.text();
        if (raw.length > 4000) return json({ error: "TOO_LARGE" }, 413);
        authBody = JSON.parse(raw);
      }
      return await handleAuth(path, authBody, req, write, async (u) => {
        const s = await sessionFor(u);
        const [owner] = await getDb().select().from(workspaceOwners).where(eq(workspaceOwners.id, 1));
        return { role: s.role, ownerId: owner?.userId ?? null };
      });
    }
    const user = await currentUser(req);
    if (!user) return json({ error: "AUTH_REQUIRED" }, 401);
    // Ideiglenes jelszóval belépve csak a munkamenet kérdezhető le, amíg új jelszót nem ad.
    if (user.mustChangePassword && path !== "/api/session") return json({ error: "PASSWORD_CHANGE_REQUIRED" }, 403);
    const actor = user.userId;
    const identity = { userId:actor,email:user.email,name:user.name };
    const session = await sessionFor(identity);
    if (write) {
      if (req.headers.get("origin") !== new URL(req.url).origin)
        return json({ error: "INVALID_ORIGIN" }, 403);
      if (!req.headers.get("content-type")?.includes("application/json"))
        return json({ error: "JSON_REQUIRED" }, 415);
    }
    const db = getDb();
    if(path.startsWith('/api/courier/')){
      let body:unknown;
      if(write){const raw=await req.text();if(raw.length>40000)return json({error:'TOO_LARGE'},413);body=JSON.parse(raw);}
      return await handleCourier(path,body,identity,session,write,new URL(req.url).searchParams.get('date')??today());
    }
    if (path.startsWith("/api/portal/")) {
      let body:unknown;
      if (write) {
        const raw=await req.text();
        if(raw.length>40000)return json({error:"TOO_LARGE"},413);
        body=JSON.parse(raw);
      }
      return await handlePortal(path,body,identity,session,write);
    }
    if (!write && path === "/api/session") return json({ ...session, mustChangePassword: Boolean(user.mustChangePassword) });
    if (!write && path === "/api/access/members") return json(await loadMembers(session));
    // v71: a futó változat (csak bejelentkezett dolgozónak).
    if (!write && path === "/api/version" && isMember(session.role)) return json({ version: env.BUILD_VERSION ?? "", commit: env.BUILD_COMMIT ?? "", builtAt: env.BUILD_TIME ?? "" });
    if (!isMember(session.role) && path !== "/api/access/request") return json({error:"ACCESS_PENDING"},403);
    // v65: beszállítói számlák (Beszerzés). A beolvasáshoz nagyobb kérés kell (a számla képe / PDF-je base64-ben).
    if(path==="/api/invoices"||path.startsWith("/api/invoices/")){
      if(!isAdmin(session.role)&&!isKitchenStaff(session.role))return json({error:"FORBIDDEN"},403);
      let body:unknown;
      if(write){const raw=await req.text();if(raw.length>(path==="/api/invoices/scan"?2_000_000:300_000))return json({error:"INVOICE_FILE_TOO_LARGE"},413);body=JSON.parse(raw);if(!canWrite(session.role,path,body))return json({error:"FORBIDDEN"},403);}
      return await handleInvoices(path,body,session,write,req);
    }
    // v73: gyártási tételek és bon de consum (csak admin; a modul ellenőrzi).
    // v76: pénzügy és pénztár (a modul ellenőrzi a szerepköröket).
    if(path==="/api/finance"||path.startsWith("/api/finance/")){
      let body:unknown;if(write){const raw=await req.text();if(raw.length>20000)return json({error:"TOO_LARGE"},413);body=JSON.parse(raw);}
      return await handleFinance(path,body,session,write,req);
    }
    // v75: aviz de însoțire a mărfii (a modul ellenőrzi a szerepköröket).
    if(path==="/api/delivery-notes"||path.startsWith("/api/delivery-notes/")){
      let body:unknown;if(write){const raw=await req.text();if(raw.length>20000)return json({error:"TOO_LARGE"},413);body=JSON.parse(raw);}
      return await handleDeliveryNotes(path,body,session,write,req);
    }
    if(path==="/api/production"||path.startsWith("/api/production/")){
      let body:unknown;if(write){const raw=await req.text();if(raw.length>100000)return json({error:"TOO_LARGE"},413);body=JSON.parse(raw);}
      return await handleProduction(path,body,session,write,req);
    }
    if(path==='/api/packing'||path.startsWith('/api/packing/')){
      let body:unknown;if(write){const raw=await req.text();if(raw.length>40000)return json({error:'TOO_LARGE'},413);body=JSON.parse(raw);}
      return await handlePacking(path,body,session,write,new URL(req.url).searchParams.get('date')??today());
    }
    if(path==='/api/labels'||path==='/api/labels/settings'){
      let body:unknown;if(write){const raw=await req.text();if(raw.length>200000)return json({error:'TOO_LARGE'},413);body=JSON.parse(raw);}
      return await handleLabels(path,body,session,write,req);
    }
    if(path==="/api/products/image"||path==="/api/products/image/remove"){
      if(!write)return json({error:"NOT_FOUND"},404);
      const raw=await req.text();if(raw.length>1000000)return json({error:"IMAGE_TOO_LARGE"},413);
      if(!canWrite(session.role,path,{}))return json({error:"FORBIDDEN"},403);
      return await handleProductImage(path,JSON.parse(raw),session);
    }
    if(path==="/api/kitchen/ready"){
      if(!write)return json({error:"NOT_FOUND"},404);
      const raw=await req.text();if(raw.length>40000)return json({error:"TOO_LARGE"},413);
      if(!canWrite(session.role,path,{}))return json({error:"FORBIDDEN"},403);
      return await handleKitchen(path,JSON.parse(raw),session,write);
    }
    if (!write && path === "/api/fulfillment") {
      if (!["owner","admin","dispatcher"].includes(session.role)) return json({error:"FORBIDDEN"},403);
      return json(await loadPolicy());
    }
    if (!write && path === "/api/stocktake") {
      if (!["owner","admin","kitchen","warehouse"].includes(session.role)) return json({error:"FORBIDDEN"},403);
      return json(await loadStocktakes());
    }
    if (!write && path === "/api/menu") {
      if (!["owner","admin","dispatcher"].includes(session.role)) return json({error:"FORBIDDEN"},403);
      return json(await loadMenu());
    }
    if (!write && path === "/api/data") {
      const admin = isAdmin(session.role);
      const stock = admin || isKitchenStaff(session.role);
      const sales = admin || session.role === "dispatcher";
      const [p, c, o, i, a, operations, purchasing, logistics, safety, recurring] = await Promise.all([
        db.select().from(products),
        sales ? db.select().from(customers) : [],
        db.select().from(orders),
        db.select().from(orderItems),
        admin ? db.select().from(audit).orderBy(desc(audit.createdAt)).limit(60) : [],
        stock ? loadOperations() : emptyOperations,
        stock ? loadPurchasing() : {suppliers:[],orders:[],events:[]},
        loadDelivery(),
        stock ? loadSafety() : {points:[],records:[]},
        sales ? loadRecurring() : {templates:[],occurrences:[]},
      ]);
      const itemsByOrder = groupRows(i, item => item.orderId);
      return json(projectData({
        recurring,
        safety,
        logistics,
        purchasing,
        operations,
        products: p,
        customers: c,
        orders: o.map((row) => ({
          ...row,
          items: itemsByOrder.get(row.id) ?? [],
        })),
        audit: a,
      }, session.role));
    }
    if (!write) return json({ error: "NOT_FOUND" }, 404);
    const raw = await req.text();
    if (raw.length > 40000) return json({ error: "TOO_LARGE" }, 413);
    const body = JSON.parse(raw);
    const now = new Date().toISOString();
    const accessResponse = await handleAccess(path, body, identity, session);
    if (accessResponse) return accessResponse;
    if (!canWrite(session.role,path,body)) return json({error:"FORBIDDEN"},403);
    if(path==="/api/fulfillment/save")return json(await savePolicy(body,actor));
    const stocktakeResponse=await handleStocktake(path,body,actor);
    if(stocktakeResponse)return stocktakeResponse;
    if(path==="/api/menu/save") return json(await saveMenu(body,actor));
    if(path==="/api/menu/settings") return json(await saveMenuSettings(body,actor));
    const recurringResponse = await handleRecurring(path,body,actor);
    if (recurringResponse) return recurringResponse;
    const safetyResponse = await handleSafety(path,body,actor,user.name);
    if (safetyResponse) return safetyResponse;
    const deliveryResponse = await handleDelivery(path, body, actor);
    if (deliveryResponse) return deliveryResponse;
    const purchaseResponse = await handlePurchasing(path, body, actor);
    if (purchaseResponse) return purchaseResponse;
    const operationResponse = await handleOperations(path, body, actor);
    if (operationResponse) return operationResponse;
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
    if (path === "/api/products" || path === "/api/products/update") {
      const editing = path === "/api/products/update";
      const p = z
        .object({
          ...(editing ? { id: text(), revision: z.number().int().min(0) } : {}),
          hu: text(),
          ro: text(),
          descriptionHu: z.string().max(1500),
          descriptionRo: z.string().max(1500),
          category: z.enum(CATEGORIES),
          section: z.enum(SECTIONS).default("alacarte"),
          price: z.number().int().min(0).max(1000000),
          portion: z.number().int().min(1).max(10000),
          allergens: z.string().max(200),
        })
        .parse(body) as { id?: string; revision?: number; hu: string; ro: string; descriptionHu: string; descriptionRo: string; category: string; section: string; price: number; portion: number; allergens: string };
      // A Napi menü részben csak leves és főétel lehet (v49, v54).
      if (p.section === "daily" && !(DAILY_CATEGORIES as readonly string[]).includes(p.category))
        return json({ error: "SECTION_CATEGORY" }, 400);
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
      if (editing) {
        // v55: étel módosítása. A korábbi rendelések pillanatképe (név, ár, allergén) nem változik;
        // a portál-változat nő, így a nyitott portálos előnézetek frissítést kérnek.
        const { id, revision, ...fields } = p;
        const [old] = await db.select().from(products).where(eq(products.id, id!));
        if (!old || old.active !== 1) return json({ error: "NOT_FOUND" }, 404);
        if (old.portalRevision !== revision) return json({ error: "CONFLICT" }, 409);
        // A Napi menüből csak akkor vihető ki, ha mai vagy későbbi nap menüjében nem szerepel.
        if (fields.section !== "daily" || !(DAILY_CATEGORIES as readonly string[]).includes(fields.category)) {
          const used = await env.DB!.prepare(
            "SELECT 1 FROM menu_days WHERE date>=? AND ? IN (set_soup_id,set_main_id) LIMIT 1",
          ).bind(today(), id).first();
          if (used) return json({ error: "SECTION_IN_USE" }, 409);
        }
        const result = await env.DB!.batch([
          env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'product_updated',?,?,? WHERE EXISTS (SELECT 1 FROM products WHERE id=? AND portal_revision=? AND active=1)").bind(crypto.randomUUID(), actor, id, fields.hu, now, id, revision),
          env.DB!.prepare("UPDATE products SET hu=?,ro=?,description_hu=?,description_ro=?,category=?,section=?,price=?,portion=?,allergens=?,portal_revision=portal_revision+1 WHERE id=? AND portal_revision=? AND active=1").bind(fields.hu, fields.ro, fields.descriptionHu, fields.descriptionRo, fields.category, fields.section, fields.price, fields.portion, fields.allergens, id, revision),
        ]);
        if (result[1]!.meta.changes !== 1) return json({ error: "CONFLICT" }, 409);
        return json({ ok: true });
      }
      const id = crypto.randomUUID();
      await db.batch([
        db.insert(products).values({ ...p, id, active: 1 }),
        db.insert(audit).values(log("product_created", id, p.hu)),
      ]);
      return json({ ok: true, id }, 201);
    }
    if (path === "/api/products/delete") {
      // v55: étel törlése. A korábbi rendelések, receptek és címkék hivatkoznak rá, ezért archiváljuk (active=0):
      // eltűnik a katalógusból, az étlapokról és a portálról; a régi rendelések pillanatképe megmarad.
      // Mai vagy későbbi foglalás esetén nem törölhető.
      const d = z.object({ id: text() }).strict().parse(body);
      const [p] = await db.select().from(products).where(eq(products.id, d.id));
      if (!p || p.active !== 1) return json({ ok: true });
      const reserved = await env.DB!.prepare(
        "SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=? AND o.date>=? AND o.status IN ('requested','confirmed') AND o.delivery<>'delivered' LIMIT 1",
      ).bind(d.id, today()).first();
      if (reserved) return json({ error: "PRODUCT_IN_USE" }, 409);
      await env.DB!.batch([
        env.DB!.prepare("UPDATE products SET active=0,portal_revision=portal_revision+1 WHERE id=?").bind(d.id),
        // A jövőbeli étlapokról és napi menükből is lekerül.
        env.DB!.prepare("DELETE FROM menu_lines WHERE product_id=? AND date>=?").bind(d.id, today()),
        env.DB!.prepare("UPDATE menu_days SET set_soup_id=CASE WHEN set_soup_id=? THEN NULL ELSE set_soup_id END,set_main_id=CASE WHEN set_main_id=? THEN NULL ELSE set_main_id END,revision=revision+1 WHERE date>=? AND (set_soup_id=? OR set_main_id=?)").bind(d.id, d.id, today(), d.id, d.id),
        // Ha a menüből csak az egyik étel maradt, a menü megszűnik (leves és főétel együtt kell).
        env.DB!.prepare("UPDATE menu_days SET set_soup_id=NULL,set_main_id=NULL WHERE date>=? AND ((set_soup_id IS NULL) <> (set_main_id IS NULL))").bind(today()),
        env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'product_deleted',?,?,?)").bind(crypto.randomUUID(), actor, d.id, p.hu, now),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/products/section") {
      // Étel áthelyezése a Napi menü és az Étlap között (v49).
      const d = z.object({ id: text(), section: z.enum(SECTIONS) }).strict().parse(body);
      const [p] = await db.select().from(products).where(eq(products.id, d.id));
      if (!p) return json({ error: "NOT_FOUND" }, 404);
      if (d.section === "daily" && !(DAILY_CATEGORIES as readonly string[]).includes(p.category))
        return json({ error: "SECTION_CATEGORY" }, 400);
      // Ha valamelyik mai vagy későbbi nap menüjében szerepel, nem vehető ki a Napi menü részből.
      if (d.section !== "daily") {
        const used = await env.DB!.prepare(
          "SELECT 1 FROM menu_days WHERE date>=? AND ? IN (set_soup_id,set_main_id,set_dessert_id) LIMIT 1",
        ).bind(today(), d.id).first();
        if (used) return json({ error: "SECTION_IN_USE" }, 409);
      }
      if (p.section === d.section) return json({ ok: true });
      await db.batch([
        db.update(products).set({ section: d.section }).where(eq(products.id, d.id)),
        db.insert(audit).values(log("product_section_changed", d.id, d.section)),
      ]);
      return json({ ok: true });
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
          // v56: meglévő ügyfél, vagy telefonos rendelésnél helyben felvett új ügyfél (pontosan az egyik).
          customerId: text().optional(),
          newCustomer: z
            .object({ name: text(), address: text(500), phone: z.string().trim().max(40) })
            .strict()
            .optional(),
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
      if (!!d.customerId === !!d.newCustomer) return json({ error: "CUSTOMER_MISSING" }, 400);
      // Új ügyfél: a rendeléssel egy tranzakcióban jön létre, így ismételt kérésből sem lesz két ügyfél.
      const created = d.newCustomer ? { id: crypto.randomUUID(), ...d.newCustomer, note: "" } : null;
      const [found] = d.customerId
        ? await db.select().from(customers).where(eq(customers.id, d.customerId))
        : [];
      const c = created ?? found;
      if (!c) return json({ error: "CUSTOMER_MISSING" }, 400);
      const catalog = await db.select().from(products);
      // Order snapshots need recipe identifiers, not lots, movements or production history.
      const recipeCatalog = (await db.select().from(recipes).where(inArray(recipes.productId,d.items.map(item=>item.productId))))
        .map(recipe=>({...recipe,lines:[]}));
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
          recipeId: latestRecipe(p.id, recipeCatalog)?.id ?? null,
        };
      });
      // Az ügyfélnek a rendelés előtt kell létrejönnie (a rendelés hivatkozik rá); a köteg egy tranzakció.
      await db.batch(([
        ...(created
          ? [db.insert(customers).values(created), db.insert(audit).values(log("customer_created", created.id, created.name))]
          : []),
        db.insert(orders).values({
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
      ]) as unknown as Parameters<typeof db.batch>[0]);
      return json({ ok: true, id: d.id }, 201);
    }
    if (path === "/api/orders/state") {
      const d = z
        .object({
          id: text(),
          revision: z.number().int().min(0),
          field: z.enum(["production", "delivery", "payment", "status"]),
          value: text(30),
          note: z.string().trim().max(500).default(""),
        })
        .parse(body);
      const [row] = await db.select().from(orders).where(eq(orders.id, d.id));
      if (!row) return json({ error: "NOT_FOUND" }, 404);
      if (row.revision !== d.revision) return json({ error: "CONFLICT" }, 409);
      // v76: a fizetés befizetésként rögzül (mód, összeg, ki vette át) – a régi „fizetve” kapcsoló megszűnt.
      if (d.field === "payment") return json({ error: "USE_PAYMENTS" }, 400);
      if (row.status === "requested" && d.field === "status" && d.value === "rejected" && !d.note)
        return json({error:"REVIEW_NOTE_REQUIRED"},400);
      if (d.field === "delivery" && d.value === "failed" && !d.note)
        return json({error:"DELIVERY_REASON_REQUIRED"},400);
      const updated = nextState(
        { ...row, items: [] } as Order,
        d.field,
        d.value,
      );
      // v50: főzés előtti lemondás = végleges törlés (rendelés, tételek, kapcsolódó sorok és napló is).
      // A nextState már ellenőrizte, hogy a főzés és a kiszállítás még nem kezdődött el.
      if (d.field === "status" && d.value === "cancelled") {
        // v76: befizetett rendelés nem mondható le, amíg a befizetést vissza nem adták (sztornó).
        const paid = await cancelPaymentState(d.id);
        if (paid.net !== 0) return json({ error: "ORDER_HAS_PAYMENTS" }, 409);
        // v75: avizos rendelés nem törölhető véglegesen: lemondott állapot + sztornó-aviz.
        if (await hasActiveNote(d.id)) {
          if (!(await cancelOrderWithNote(d.id, d.revision, actor, d.note || "comandă anulată"))) return json({ error: "CONFLICT" }, 409);
          return json({ ok: true, deleted: false });
        }
        // v76: ha volt (sztornózott) befizetése, a bizonylatai miatt nem törlődik, csak lemondott lesz.
        if (paid.hasRows) {
          const r = await env.DB!.batch([
            env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status IN ('requested','confirmed') AND production='queued' AND delivery='pending') AND (SELECT COALESCE(SUM(amount),0) FROM payments WHERE order_id=?)=0 THEN ? ELSE NULL END,'order_cancelled',?,?,?)").bind(crypto.randomUUID(), d.id, d.revision, d.id, actor, d.id, JSON.stringify({ note: d.note }), now),
            env.DB!.prepare("UPDATE orders SET status='cancelled',revision=revision+1 WHERE id=? AND revision=?").bind(d.id, d.revision),
          ]).catch(() => null);
          if (!r || r[1]!.meta.changes !== 1) return json({ error: "CONFLICT" }, 409);
          return json({ ok: true, deleted: false });
        }
        const deleted = await hardDeleteOrder(
          d.id,
          "EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status IN ('requested','confirmed') AND production='queued' AND delivery='pending')",
          [d.id, d.revision],
        );
        if (!deleted) return json({ error: "CONFLICT" }, 409);
        return json({ ok: true, deleted: true });
      }
      // v51: egy futár van; induláskor az ő neve (futár szerepkörű felhasználó) kerül a rendelésre.
      const courierName = d.field === "delivery" && d.value === "transit" ? await courierUserName() : row.courierName;
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
            JSON.stringify({ field: d.field, from: row[d.field], to: d.value, note:d.note, courier:row.courierName }),
            now,
            d.id,
            d.revision,
          ),
        ...(d.field === "delivery" ? [env.DB!.prepare("INSERT INTO delivery_events (id,order_id,kind,detail,actor,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=?)").bind(crypto.randomUUID(),d.id,d.value,JSON.stringify({note:d.note,courier:row.courierName}),actor,now,d.id,d.revision)] : []),
        env
          .DB!.prepare(
            `UPDATE orders SET ${d.field}=?,revision=?,courier_name=CASE WHEN ?='delivery' AND ?='transit' THEN ? ELSE courier_name END,review_note=CASE WHEN ?='status' AND status='requested' AND ? IN ('confirmed','rejected') THEN ? ELSE review_note END WHERE id=? AND revision=?`,
          )
          .bind(d.value, updated.revision, d.field, d.value, courierName, d.field, d.value, d.note, d.id, d.revision),
      ]);
      if (result[result.length - 1].meta.changes !== 1) return json({ error: "CONFLICT" }, 409);
      return json({ ok: true });
    }
    return json({ error: "NOT_FOUND" }, 404);
  } catch (e) {
    if (e instanceof PackingError) return json({error:e.message},e.status);
    if (e instanceof LabelError) return json({error:e.message},e.status);
    if (e instanceof KitchenError) return json({error:e.code},e.status);
    if (e instanceof AuthError) return json({error:e.code},e.status);
    if (e instanceof ImageError) return json({error:e.code},e.status);
    if (e instanceof CourierError) return json({error:e.code},e.status);
    if (e instanceof FulfillmentError) return json({error:e.code},e.status);
    if (/FULFILLMENT_CAPACITY/.test(String(e)))return json({error:"FULFILLMENT_CAPACITY"},409);
    if (e instanceof StocktakeError) return json({error:e.code},e.status);
    if (e instanceof MenuError) return json({error:e.code},e.status);
    if (/MENU_CAPACITY/.test(String(e))) return json({error:"MENU_CAPACITY"},409);
    if (e instanceof PortalError) return json({error:e.code},e.status);
    if (e instanceof RecurringError) return json({error:e.code},e.status);
    if (e instanceof SafetyError) return json({error:e.code},e.status);
    if (e instanceof AccessError) return json({error:e.code},e.status);
    if (e instanceof DeliveryError) return json({ error: e.code }, e.status);
    if (e instanceof PurchaseError) return json({ error: e.code }, e.status);
    if (e instanceof InvoiceError) return json({ error: e.code }, e.status);
    if (e instanceof ProductionError) return json({ error: e.code }, e.status);
    if (e instanceof DeliveryNoteError) return json({ error: e.code }, e.status);
    if (e instanceof FinanceError) return json({ error: e.code }, e.status);
    if (e instanceof OperationError) return json({ error: e.code }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: "VALIDATION" }, 400);
    const code = e instanceof Error ? e.message : "";
    if (
      [
        "CANCELLED",
        "REJECTED",
        "ORDER_NOT_CONFIRMED",
        "INVALID_TRANSITION",
        "NOT_READY",
        "PACKING_REQUIRED",
        "PACKING_ITEMS",
        "COURIER_REQUIRED",
        "ALREADY_STARTED",
        "INVALID_ITEM",
        "INVALID_SAFETY_RESULT",
        "RECURRING_RANGE",
      ].includes(code)
    )
      return json({ error: code }, 400);
    console.error(e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
export const GET = (r: Request) => handle(r, false);
export const POST = (r: Request) => handle(r, true);
