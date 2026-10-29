import {env} from 'cloudflare:workers';
import {and,asc,eq} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {orders,orderItems} from '@/db/schema';
import type {Session} from '../access/domain';
import {today,type Order,canCheckPacking} from '../shared/domain';
import {validDay,addDays} from '../menu/domain';
import {packingOrder,packingSelection,needsPacking} from './domain';
export class PackingError extends Error{constructor(message:string,public status=400){super(message);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function handlePacking(path:string,body:unknown,session:Session,write:boolean,date:string){
 if(!['owner','admin','kitchen','dispatcher'].includes(session.role))throw new PackingError('FORBIDDEN',403);
 const db=getDb();
 if(!write&&path==='/api/packing'){
  if(!validDay(date)||date<addDays(today(),-90)||date>addDays(today(),90))throw new PackingError('PACKING_DATE');
  const scope=and(eq(orders.date,date),eq(orders.status,'confirmed'));
  const [rows,itemRows]=await Promise.all([db.select().from(orders).where(scope).orderBy(asc(orders.time),asc(orders.id)),db.select({item:orderItems}).from(orderItems).innerJoin(orders,eq(orders.id,orderItems.orderId)).where(scope)]);
  return json({date,orders:rows.filter(needsPacking).map(o=>packingOrder({...o,items:itemRows.filter(r=>r.item.orderId===o.id).map(r=>r.item)} as Order))});
 }
 if(!write||path!=='/api/packing/check')return json({error:'NOT_FOUND'},404);
 const d=z.object({id:z.string().min(1).max(200),revision:z.number().int().min(0),itemIds:z.array(z.string().min(1).max(200)).max(50)}).strict().parse(body);
 const [o]=await db.select().from(orders).where(eq(orders.id,d.id));if(!o)throw new PackingError('NOT_FOUND',404);
 if(o.revision!==d.revision)throw new PackingError('CONFLICT',409);
 if(!canCheckPacking(o as Order))throw new PackingError('PACKING_STATE');
 const items=await db.select().from(orderItems).where(eq(orderItems.orderId,o.id));
 const check=packingSelection(items,d.itemIds),now=new Date().toISOString();
 // CAS, checklist, ready flag and audit are committed in the same transaction.
 const result=await env.DB!.batch([
  env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'packing_checked',?,?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status='confirmed' AND production='ready' AND delivery IN ('pending','failed'))").bind(crypto.randomUUID(),session.userId,d.id,JSON.stringify({itemIds:check.checkedItemIds,ready:check.ready}),now,d.id,d.revision),
  env.DB!.prepare("UPDATE orders SET packing_items=?,packing_ready=?,packing_checked_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='confirmed' AND production='ready' AND delivery IN ('pending','failed')").bind(JSON.stringify(check.checkedItemIds),check.ready?1:0,check.ready?now:'',d.id,d.revision),
 ]);
 if(result[1].meta.changes!==1)throw new PackingError('CONFLICT',409);
 return json({ok:true});
}
