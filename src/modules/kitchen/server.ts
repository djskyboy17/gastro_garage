import {env} from 'cloudflare:workers';
import {z} from 'zod';
import type {Session} from '../access/domain';
export class KitchenError extends Error{constructor(public code:string,public status=400){super(code);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
/** Csak visszaigazolt, még nem kész rendelés tétele jelölhető késznek. */
const openOrder="SELECT id FROM orders WHERE status='confirmed' AND production IN ('queued','cooking')";
/**
 * A konyha „Kész” gombja: a megadott tételeket késznek jelöli. Ha egy rendelés minden tétele kész,
 * a rendelés gyártási állapota „ready” lesz (csomagolható); ha csak egy része, „cooking”.
 * Ismételt hívás nem okoz hibát (már kész tétel nem változik).
 */
export async function handleKitchen(path:string,body:unknown,session:Session,write:boolean){
 if(!write||path!=='/api/kitchen/ready')return json({error:'NOT_FOUND'},404);
 if(!['owner','admin','kitchen'].includes(session.role))throw new KitchenError('FORBIDDEN',403);
 const d=z.object({itemIds:z.array(z.string().min(1).max(200)).min(1).max(500)}).strict().parse(body);
 const ids=JSON.stringify([...new Set(d.itemIds)]),now=new Date().toISOString();
 const touched=`SELECT DISTINCT order_id FROM order_items WHERE id IN (SELECT value FROM json_each(?))`;
 // Tételek, rendelésállapot és napló egy tranzakcióban.
 const result=await env.DB!.batch([
  env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'kitchen_items_ready',?,?,? WHERE EXISTS (SELECT 1 FROM order_items WHERE ready=0 AND id IN (SELECT value FROM json_each(?)) AND order_id IN (${openOrder}))`).bind(crypto.randomUUID(),session.userId,'order_items',JSON.stringify({itemIds:JSON.parse(ids)}),now,ids),
  env.DB!.prepare(`UPDATE order_items SET ready=1 WHERE ready=0 AND id IN (SELECT value FROM json_each(?)) AND order_id IN (${openOrder})`).bind(ids),
  env.DB!.prepare(`UPDATE orders SET production='ready',revision=revision+1 WHERE status='confirmed' AND production IN ('queued','cooking') AND id IN (${touched}) AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=orders.id AND i.ready=0)`).bind(ids),
  env.DB!.prepare(`UPDATE orders SET production='cooking',revision=revision+1 WHERE status='confirmed' AND production='queued' AND id IN (${touched})`).bind(ids),
 ]);
 return json({ok:true,items:result[1]!.meta.changes,ready:result[2]!.meta.changes});
}
