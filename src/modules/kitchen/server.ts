import {env} from 'cloudflare:workers';
import {z} from 'zod';
import type {Session} from '../access/domain';
import {nextState,type Order} from '../shared/domain';
export class KitchenError extends Error{constructor(public code:string,public status=400){super(code);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
/** Csak visszaigazolt, még nem kész rendelés tétele jelölhető késznek. */
const openOrder="SELECT id FROM orders WHERE status='confirmed' AND production IN ('queued','cooking')";
const kitchenRoles=['owner','admin','kitchen','warehouse'];
/**
 * A konyha „Kész” gombja: a megadott tételeket késznek jelöli. Ha egy rendelés minden tétele kész,
 * a rendelés gyártási állapota „ready” lesz (csomagolható); ha csak egy része, „cooking”.
 * Ismételt hívás nem okoz hibát (már kész tétel nem változik).
 */
export async function handleKitchen(path:string,body:unknown,session:Session,write:boolean){
 if(!write||path!=='/api/kitchen/ready')return json({error:'NOT_FOUND'},404);
 const d=z.object({itemIds:z.array(z.string().min(1).max(200)).min(1).max(500)}).strict().parse(body);
 return json({ok:true,...(await markItemsReady(d.itemIds,session))});
}
export async function markItemsReady(itemIds:string[],session:Session){
 if(!kitchenRoles.includes(session.role))throw new KitchenError('FORBIDDEN',403);
 const ids=JSON.stringify([...new Set(itemIds)]),now=new Date().toISOString();
 const touched=`SELECT DISTINCT order_id FROM order_items WHERE id IN (SELECT value FROM json_each(?))`;
 // Tételek, rendelésállapot és napló egy tranzakcióban.
 const result=await env.DB!.batch([
  env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'kitchen_items_ready',?,?,? WHERE EXISTS (SELECT 1 FROM order_items WHERE ready=0 AND id IN (SELECT value FROM json_each(?)) AND order_id IN (${openOrder}))`).bind(crypto.randomUUID(),session.userId,'order_items',JSON.stringify({itemIds:JSON.parse(ids)}),now,ids),
  env.DB!.prepare(`UPDATE order_items SET ready=1 WHERE ready=0 AND id IN (SELECT value FROM json_each(?)) AND order_id IN (${openOrder})`).bind(ids),
  env.DB!.prepare(`UPDATE orders SET production='ready',revision=revision+1 WHERE status='confirmed' AND production IN ('queued','cooking') AND id IN (${touched}) AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=orders.id AND i.ready=0)`).bind(ids),
  env.DB!.prepare(`UPDATE orders SET production='cooking',revision=revision+1 WHERE status='confirmed' AND production='queued' AND id IN (${touched})`).bind(ids),
 ]);
 return {items:result[1]!.meta.changes,ready:result[2]!.meta.changes};
}
/** Egy rendelés minden még nem kész tételét késznek jelöli (konyhai kijelző „Elkészült” gombja). Ismételve is biztonságos. */
export async function markOrderReady(orderId:string,session:Session){
 if(!kitchenRoles.includes(session.role))throw new KitchenError('FORBIDDEN',403);
 const order=await env.DB!.prepare("SELECT status,production FROM orders WHERE id=?").bind(orderId).first<{status:string;production:string}>();
 if(!order)throw new KitchenError('NOT_FOUND',404);
 if(order.production==='ready')return {items:0,ready:0};
 if(order.status!=='confirmed')throw new KitchenError('ORDER_NOT_CONFIRMED');
 const rows=await env.DB!.prepare("SELECT id FROM order_items WHERE order_id=? AND ready=0").bind(orderId).all<{id:string}>();
 const ids=rows.results.map(r=>r.id);
 if(!ids.length)throw new KitchenError('INVALID_ITEM');
 return markItemsReady(ids,session);
}
/**
 * Konyhai kijelző „Elfogadom” gombja: ha a rendelés még visszaigazolásra vár (portálos kérés), visszaigazolja,
 * és a gyártást is elindítja (requested/queued → confirmed/cooking); ha már visszaigazolt, csak a gyártást indítja.
 * Ugyanazok az állapotszabályok (`nextState`) és naplóbejegyzések, mint a fő alkalmazásban. Ismételve is biztonságos.
 * Elutasítani a konyha nem tud; az továbbra is az admin és a diszpécser dolga.
 */
export async function acceptOrder(orderId:string,session:Session){
 if(!kitchenRoles.includes(session.role))throw new KitchenError('FORBIDDEN',403);
 const row=await env.DB!.prepare("SELECT id,status,production,delivery,payment,revision,fulfillment_mode AS fulfillmentMode,courier_id AS courierId,packing_ready AS packingReady,courier_name AS courierName FROM orders WHERE id=?").bind(orderId).first<Order&{courierName:string}>();
 if(!row)throw new KitchenError('NOT_FOUND',404);
 if(row.status!=='requested')return startCooking(orderId,session);
 let confirmed:Order,cooking:Order;
 try{
  confirmed=nextState({...row,items:[]},'status','confirmed');
  cooking=nextState(confirmed,'production','cooking');
 }catch(e){throw new KitchenError(e instanceof Error?e.message:'INVALID_TRANSITION');}
 const now=new Date().toISOString(),guard="WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status='requested')";
 const result=await env.DB!.batch([
  env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'state_changed',?,?,? ${guard}`).bind(crypto.randomUUID(),session.userId,orderId,JSON.stringify({field:'status',from:'requested',to:'confirmed',note:'',courier:row.courierName,via:'kitchen_display'}),now,orderId,row.revision),
  env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'state_changed',?,?,? ${guard}`).bind(crypto.randomUUID(),session.userId,orderId,JSON.stringify({field:'production',from:row.production,to:'cooking',note:'',courier:row.courierName,via:'kitchen_display'}),now,orderId,row.revision),
  env.DB!.prepare("UPDATE orders SET status='confirmed',production='cooking',revision=? WHERE id=? AND revision=? AND status='requested' AND production='queued'").bind(cooking.revision,orderId,row.revision),
 ]);
 if(result[2]!.meta.changes!==1){
  // Közben más is módosította: ha azóta már visszaigazolt és készül vagy kész, az is jó eredmény.
  const now2=await env.DB!.prepare("SELECT status,production FROM orders WHERE id=?").bind(orderId).first<{status:string;production:string}>();
  if(now2&&now2.status==='confirmed'&&now2.production!=='queued')return {changed:false};
  if(now2&&now2.status==='confirmed')return startCooking(orderId,session);
  throw new KitchenError(now2?.status==='cancelled'?'CANCELLED':now2?.status==='rejected'?'REJECTED':'CONFLICT',409);
 }
 return {changed:true};
}
/**
 * „Folyamatban”: a gyártás megkezdése (queued → cooking), ugyanazzal a naplóbejegyzéssel, mint a rendelés állapotváltása.
 * Ismételve is biztonságos: ha a rendelés már készül vagy kész, nem változtat semmit.
 */
export async function startCooking(orderId:string,session:Session){
 if(!kitchenRoles.includes(session.role))throw new KitchenError('FORBIDDEN',403);
 const row=await env.DB!.prepare("SELECT id,status,production,delivery,payment,revision,fulfillment_mode AS fulfillmentMode,courier_id AS courierId,packing_ready AS packingReady,courier_name AS courierName FROM orders WHERE id=?").bind(orderId).first<Order&{courierName:string}>();
 if(!row)throw new KitchenError('NOT_FOUND',404);
 if(row.production!=='queued')return {changed:false};
 let updated:Order;
 try{updated=nextState({...row,items:[]},'production','cooking');}catch(e){throw new KitchenError(e instanceof Error?e.message:'INVALID_TRANSITION');}
 const now=new Date().toISOString();
 const result=await env.DB!.batch([
  env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'state_changed',?,?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=?)").bind(crypto.randomUUID(),session.userId,orderId,JSON.stringify({field:'production',from:'queued',to:'cooking',note:'',courier:row.courierName}),now,orderId,row.revision),
  env.DB!.prepare("UPDATE orders SET production='cooking',revision=? WHERE id=? AND revision=? AND production='queued'").bind(updated.revision,orderId,row.revision),
 ]);
 if(result[1]!.meta.changes!==1){
  // Közben más is módosította: ha azóta már készül vagy kész, az is jó eredmény.
  const now2=await env.DB!.prepare("SELECT production FROM orders WHERE id=?").bind(orderId).first<{production:string}>();
  if(now2&&now2.production!=='queued')return {changed:false};
  throw new KitchenError('CONFLICT',409);
 }
 return {changed:true};
}
