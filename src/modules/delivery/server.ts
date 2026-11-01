import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { deliveryEvents, members, orders } from "@/db/schema";
import { canAssign, pickupSwitch, type DeliveryData } from "./domain";
import { orderFulfillment } from "../fulfillment/domain";
import { loadPolicy } from "../fulfillment/server";
export class DeliveryError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const json = (v: unknown, status = 200) => Response.json(v, {status, headers:{"Cache-Control":"no-store"}});
export async function loadDelivery(): Promise<DeliveryData> {
  const events = await getDb().select().from(deliveryEvents).orderBy(desc(deliveryEvents.createdAt)).limit(200);
  return { events };
}
/**
 * v51: egyetlen futár van, külön futártörzs nélkül. A futár neve a futár szerepkörű felhasználó neve
 * (ha több ilyen fiók van, a legrégebbi). Ezt kapja a rendelés, ha nem a futár maga indítja a kiszállítást.
 */
export async function courierUserName(): Promise<string> {
  const [m] = await getDb().select({ name: members.name }).from(members).where(eq(members.role, "courier")).orderBy(asc(members.createdAt)).limit(1);
  return m?.name ?? "";
}
export async function handleDelivery(path: string, body: unknown, actor: string): Promise<Response | null> {
  if (!path.startsWith("/api/delivery/")) return null;
  const db = getDb(), now = new Date().toISOString();
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
        env.DB!.prepare("UPDATE orders SET fulfillment_mode='pickup',fulfillment_slot_id=NULL,fulfillment_postal_code='',fulfillment_snapshot=?,delivery_fee=?,address=?,courier_name='',courier_phone='',revision=revision+1 WHERE id=? AND revision=?").bind(JSON.stringify(sw.snapshot),sw.fee,sw.address||o.address,d.id,d.revision),
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
