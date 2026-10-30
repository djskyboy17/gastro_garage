import { env } from "cloudflare:workers";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { couriers, courierShifts, deliveryEvents, orders, audit } from "@/db/schema";
import { canAssign, pickupSwitch, shiftCouriers, suggestCourier, type DeliveryData } from "./domain";
import { orderFulfillment } from "../fulfillment/domain";
import { loadPolicy } from "../fulfillment/server";
import { today } from "../shared/domain";
import { addDays, validDay } from "../menu/domain";
export class DeliveryError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const json = (v: unknown, status = 200) => Response.json(v, {status, headers:{"Cache-Control":"no-store"}});
export async function loadDelivery(): Promise<DeliveryData> {
  const db = getDb();
  const [c,e,s] = await Promise.all([db.select().from(couriers).orderBy(asc(couriers.name)), db.select().from(deliveryEvents).orderBy(desc(deliveryEvents.createdAt)).limit(200), db.select({date:courierShifts.date,courierId:courierShifts.courierId}).from(courierShifts).where(gte(courierShifts.date,addDays(today(),-7)))]);
  return {couriers:c, events:e, shifts:s};
}
/** Az adott napra beosztott futárok, javasolt sorrendben (legkevesebb nyitott kiszállítás elöl). */
export async function couriersOnShift(date: string): Promise<{ id: string; name: string; load: number }[]> {
  const db = getDb();
  const [list, shifts, dayOrders] = await Promise.all([
    db.select().from(couriers).orderBy(asc(couriers.name)),
    db.select({date:courierShifts.date,courierId:courierShifts.courierId}).from(courierShifts).where(eq(courierShifts.date,date)),
    db.select({date:orders.date,courierId:orders.courierId,delivery:orders.delivery,status:orders.status}).from(orders).where(eq(orders.date,date)),
  ]);
  const on = shiftCouriers(list, shifts, date).map((c) => ({ id: c.id, name: c.name, load: dayOrders.filter((o) => o.courierId === c.id && o.status === "confirmed" && o.delivery !== "delivered").length }));
  const first = suggestCourier(on, dayOrders as Parameters<typeof suggestCourier>[1], date);
  return on.sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
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
  if (path === "/api/delivery/shift") {
    // Napi beosztás: be- vagy kijelölés; ismételt kérés nem változtat (idempotens).
    const d = z.object({date:z.string(),courierId:z.string().uuid(),onShift:z.boolean()}).strict().parse(body);
    if (!validDay(d.date) || d.date < addDays(today(),-7) || d.date > addDays(today(),90)) throw new DeliveryError("PACKING_DATE");
    const [c] = await db.select().from(couriers).where(eq(couriers.id,d.courierId));
    if (!c) throw new DeliveryError("COURIER_MISSING");
    const [old] = await db.select().from(courierShifts).where(and(eq(courierShifts.date,d.date),eq(courierShifts.courierId,d.courierId)));
    if (!!old === d.onShift) return json({ok:true});
    const log = db.insert(audit).values({id:crypto.randomUUID(),actor,action:d.onShift?"courier_shift_added":"courier_shift_removed",entity:d.courierId,detail:JSON.stringify({date:d.date,name:c.name}),createdAt:now});
    if (d.onShift) await db.batch([db.insert(courierShifts).values({date:d.date,courierId:d.courierId,createdAt:now}).onConflictDoNothing(), log]);
    else await db.batch([db.delete(courierShifts).where(and(eq(courierShifts.date,d.date),eq(courierShifts.courierId,d.courierId))), log]);
    return json({ok:true});
  }
  if (path === "/api/delivery/to-pickup") {
    const d = z.object({id:z.string().min(1).max(200),revision:z.number().int().min(0),removeFee:z.boolean()}).strict().parse(body);
    const [o] = await db.select().from(orders).where(eq(orders.id,d.id));
    if (!o) throw new DeliveryError("NOT_FOUND",404);
    if (o.revision !== d.revision) throw new DeliveryError("CONFLICT",409);
    if (!canAssign(o)) throw new DeliveryError("ASSIGNMENT_LOCKED");
    const {policy} = await loadPolicy();
    const sw = pickupSwitch(orderFulfillment(o) as Parameters<typeof pickupSwitch>[0], policy, o.deliveryFee, d.removeFee);
    const detail = JSON.stringify({removeFee:d.removeFee,oldFee:o.deliveryFee,newFee:sw.fee,courier:o.courierName});
    try {
      await env.DB!.batch([
        env.DB!.prepare("INSERT INTO delivery_events (id,order_id,kind,detail,actor,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status='confirmed' AND fulfillment_mode='delivery' AND delivery IN ('pending','failed')) THEN ? ELSE NULL END,'to_pickup',?,?,?)").bind(crypto.randomUUID(),d.id,d.revision,d.id,detail,actor,now),
        env.DB!.prepare("UPDATE orders SET fulfillment_mode='pickup',fulfillment_slot_id=NULL,fulfillment_postal_code='',fulfillment_snapshot=?,delivery_fee=?,address=?,courier_id=NULL,courier_name='',courier_phone='',revision=revision+1 WHERE id=? AND revision=?").bind(JSON.stringify(sw.snapshot),sw.fee,sw.address||o.address,d.id,d.revision),
        env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),actor,"fulfillment_switched_pickup",d.id,detail,now),
      ]);
    } catch (e) {
      if (/NOT NULL|FOREIGN KEY|UNIQUE/.test(String(e))) throw new DeliveryError("CONFLICT",409);
      throw e;
    }
    return json({ok:true});
  }
  return json({error:"NOT_FOUND"},404);
}
