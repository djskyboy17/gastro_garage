import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { couriers, deliveryEvents, orders, audit } from "@/db/schema";
import { canAssign, type DeliveryData } from "./domain";
export class DeliveryError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const json = (v: unknown, status = 200) => Response.json(v, {status, headers:{"Cache-Control":"no-store"}});
export async function loadDelivery(): Promise<DeliveryData> {
  const db = getDb();
  const [c,e] = await Promise.all([db.select().from(couriers).orderBy(asc(couriers.name)), db.select().from(deliveryEvents).orderBy(desc(deliveryEvents.createdAt)).limit(200)]);
  return {couriers:c, events:e};
}
export async function handleDelivery(path: string, body: unknown, actor: string): Promise<Response | null> {
  if (!path.startsWith("/api/delivery/")) return null;
  const db = getDb(), now = new Date().toISOString();
  if (path === "/api/delivery/couriers") {
    const d = z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(150),phone:z.string().trim().max(40),vehicle:z.string().trim().max(100),note:z.string().trim().max(500)}).parse(body);
    const [old] = await db.select().from(couriers).where(eq(couriers.id,d.id));
    if (old) {
      if (["name","phone","vehicle","note"].some(k => old[k as keyof typeof d] !== d[k as keyof typeof d])) throw new DeliveryError("CONFLICT",409);
      return json({ok:true,id:d.id});
    }
    await db.batch([db.insert(couriers).values({...d,createdAt:now}),db.insert(audit).values({id:crypto.randomUUID(),actor,action:"courier_created",entity:d.id,detail:d.name,createdAt:now})]);
    return json({ok:true,id:d.id},201);
  }
  if (path === "/api/delivery/assign") {
    const d = z.object({id:z.string().min(1).max(200),revision:z.number().int().min(0),courierId:z.string().uuid().nullable(),note:z.string().trim().max(500)}).parse(body);
    const [o] = await db.select().from(orders).where(eq(orders.id,d.id));
    if (!o) throw new DeliveryError("NOT_FOUND",404);
    if (o.revision !== d.revision) throw new DeliveryError("CONFLICT",409);
    if (!canAssign(o)) throw new DeliveryError("ASSIGNMENT_LOCKED");
    const [c] = d.courierId ? await db.select().from(couriers).where(eq(couriers.id,d.courierId)) : [];
    if (d.courierId && !c) throw new DeliveryError("COURIER_MISSING");
    if (o.courierId === d.courierId) return json({ok:true});
    const detail = JSON.stringify({from:o.courierName,to:c?.name ?? "",note:d.note});
    try {
      await env.DB!.batch([
        env.DB!.prepare("INSERT INTO delivery_events (id,order_id,kind,detail,actor,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status='confirmed' AND delivery IN ('pending','failed')) THEN ? ELSE NULL END,'assigned',?,?,?)").bind(crypto.randomUUID(),d.id,d.revision,d.id,detail,actor,now),
        env.DB!.prepare("UPDATE orders SET courier_id=?,courier_name=?,courier_phone=?,revision=revision+1 WHERE id=? AND revision=?").bind(c?.id ?? null,c?.name ?? "",c?.phone ?? "",d.id,d.revision),
        env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),actor,"courier_assigned",d.id,detail,now),
      ]);
    } catch (e) {
      if (/NOT NULL|FOREIGN KEY|UNIQUE/.test(String(e))) throw new DeliveryError("CONFLICT",409);
      throw e;
    }
    return json({ok:true});
  }
  return json({error:"NOT_FOUND"},404);
}
