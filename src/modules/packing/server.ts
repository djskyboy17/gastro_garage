import {env} from 'cloudflare:workers';
import {and,asc,eq} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {orders,orderItems} from '@/db/schema';
import type {Session} from '../access/domain';
import {today,type Order} from '../shared/domain';
import {validDay,addDays} from '../menu/domain';
import {packingOrder,needsPacking} from './domain';
export class PackingError extends Error{constructor(message:string,public status=400){super(message);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function handlePacking(path:string,body:unknown,session:Session,write:boolean,date:string){
 if(!['owner','admin','kitchen','warehouse','dispatcher'].includes(session.role))throw new PackingError('FORBIDDEN',403);
 const db=getDb();
 if(!write&&path==='/api/packing'){
  if(!validDay(date)||date<addDays(today(),-90)||date>addDays(today(),90))throw new PackingError('PACKING_DATE');
  const scope=and(eq(orders.date,date),eq(orders.status,'confirmed'));
  const [rows,itemRows]=await Promise.all([db.select().from(orders).where(scope).orderBy(asc(orders.time),asc(orders.id)),db.select({item:orderItems}).from(orderItems).innerJoin(orders,eq(orders.id,orderItems.orderId)).where(scope)]);
  return json({date,orders:rows.filter(needsPacking).map(o=>packingOrder({...o,items:itemRows.filter(r=>r.item.orderId===o.id).map(r=>r.item)} as Order))});
 }
 return json({error:'NOT_FOUND'},404);
}
