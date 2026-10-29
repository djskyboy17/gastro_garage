import {env} from 'cloudflare:workers';
import {and,eq,inArray,or,lt,ne,asc} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {couriers,members,orders,orderItems,deliveryEvents} from '@/db/schema';
import {isAdmin,type Session} from '../access/domain';
import type {Identity} from '../access/server';
import {today,nextState,type Order} from '../shared/domain';
import {validDay,addDays} from '../menu/domain';
import {courierTask,type CourierAccounts,type CourierTasks} from './domain';
export class CourierError extends Error{constructor(public code:string,public status=400){super(code);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
async function linked(userId:string,session:Session){
  if(session.role!=='courier')throw new CourierError('COURIER_ROLE_REQUIRED',403);
  const [row]=await getDb().select({courier:couriers}).from(couriers).innerJoin(members,eq(members.userId,couriers.userId)).where(and(eq(couriers.userId,userId),eq(members.role,'courier')));
  if(!row)throw new CourierError('COURIER_NOT_LINKED',403);return row.courier;
}
export async function handleCourier(path:string,body:unknown,user:Identity,session:Session,write:boolean,date:string):Promise<Response>{
  const db=getDb(),now=new Date().toISOString();
  if(!write&&path==='/api/courier/accounts'){
    if(!isAdmin(session.role))throw new CourierError('FORBIDDEN',403);
    const [c,m]=await Promise.all([db.select({id:couriers.id,name:couriers.name,userId:couriers.userId,bindingRevision:couriers.bindingRevision}).from(couriers),db.select({userId:members.userId,name:members.name,email:members.email}).from(members).where(eq(members.role,'courier'))]);
    const data:CourierAccounts={couriers:c,members:m};return json(data);
  }
  if(write&&path==='/api/courier/bind'){
    if(!isAdmin(session.role))throw new CourierError('FORBIDDEN',403);
    const d=z.object({courierId:z.string().uuid(),revision:z.number().int().min(0),userId:z.string().min(1).max(200).nullable()}).strict().parse(body);
    const [old]=await db.select().from(couriers).where(eq(couriers.id,d.courierId));if(!old)throw new CourierError('NOT_FOUND',404);
    if(old.bindingRevision!==d.revision)throw new CourierError('CONFLICT',409);
    if(d.userId){const [m]=await db.select().from(members).where(eq(members.userId,d.userId));if(m?.role!=='courier')throw new CourierError('COURIER_ROLE_REQUIRED');}
    if(old.userId===d.userId)return json({ok:true});
    try{await env.DB!.batch([
      env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM couriers WHERE id=? AND binding_revision=?) AND (? IS NULL OR EXISTS (SELECT 1 FROM members WHERE user_id=? AND role='courier')) THEN ? ELSE NULL END,'courier_account_bound',?,?,?)").bind(crypto.randomUUID(),d.courierId,d.revision,d.userId,d.userId,user.userId,d.courierId,JSON.stringify({from:old.userId,to:d.userId}),now),
      env.DB!.prepare('UPDATE couriers SET user_id=?,binding_revision=binding_revision+1 WHERE id=? AND binding_revision=?').bind(d.userId,d.courierId,d.revision),
    ]);}catch(e){if(/UNIQUE/.test(String(e)))throw new CourierError('COURIER_ACCOUNT_USED',409);if(/NOT NULL|FOREIGN KEY/.test(String(e)))throw new CourierError('CONFLICT',409);throw e;}
    return json({ok:true});
  }
  const c=await linked(user.userId,session);
  if(!write&&path==='/api/courier/tasks'){
    if(!validDay(date)||date<addDays(today(),-30)||date>addDays(today(),30))throw new CourierError('COURIER_DATE');
    const scope=and(eq(orders.courierId,c.id),eq(orders.status,'confirmed'),ne(orders.fulfillmentMode,'pickup'),or(eq(orders.date,date),eq(orders.delivery,'transit'),and(lt(orders.date,today()),ne(orders.delivery,'delivered'))));
    const rows=await db.select().from(orders).where(scope).orderBy(asc(orders.date),asc(orders.time));
    const ids=rows.map(o=>o.id);
    const [itemRows,eventRows]=ids.length?await Promise.all([db.select({item:orderItems}).from(orderItems).innerJoin(orders,eq(orders.id,orderItems.orderId)).where(scope),db.select({event:deliveryEvents}).from(deliveryEvents).innerJoin(orders,eq(orders.id,deliveryEvents.orderId)).where(and(scope,inArray(deliveryEvents.kind,['transit','delivered','failed'])))]):[[],[]];
    const items=itemRows.map(r=>r.item),events=eventRows.map(r=>r.event);
    const data:CourierTasks={date,courier:{name:c.name,vehicle:c.vehicle},tasks:rows.map(o=>{const task=courierTask({...o,items:items.filter(i=>i.orderId===o.id)} as Order);return {...task,events:events.filter(e=>e.orderId===o.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(e=>{let note='';try{note=String(JSON.parse(e.detail).note??'');}catch{}return {kind:e.kind,note,createdAt:e.createdAt};})};})};const current=await linked(user.userId,session);if(current.id!==c.id||current.bindingRevision!==c.bindingRevision)throw new CourierError('COURIER_NOT_LINKED',403);
    const stillAssigned=ids.length?await db.select({id:orders.id}).from(orders).where(scope):[];
    data.tasks=data.tasks.filter(t=>stillAssigned.some(o=>o.id===t.id));return json(data);
  }
  if(!write||path!=='/api/courier/state')return json({error:'NOT_FOUND'},404);
  const d=z.object({requestId:z.string().uuid(),orderId:z.string().min(1).max(200),revision:z.number().int().min(0),value:z.enum(['transit','delivered','failed']),note:z.string().trim().max(500)}).strict().parse(body),request=JSON.stringify(d);
  const [o]=await db.select().from(orders).where(and(eq(orders.id,d.orderId),eq(orders.courierId,c.id),eq(orders.status,'confirmed'),ne(orders.fulfillmentMode,'pickup')));if(!o)throw new CourierError('NOT_FOUND',404);
  async function replay(){const [event]=await db.select().from(deliveryEvents).where(eq(deliveryEvents.id,d.requestId));if(!event)return false;let saved;try{saved=JSON.parse(event.detail).request;}catch{}if(event.actor!==user.userId||saved!==request)throw new CourierError('CONFLICT',409);return true;}
  if(await replay())return json({ok:true});
  if(o.revision!==d.revision)throw new CourierError('CONFLICT',409);
  if(d.value==='failed'&&!d.note)throw new CourierError('DELIVERY_REASON_REQUIRED');
  const updated=nextState({...o,items:[]} as Order,'delivery',d.value);
  try{await env.DB!.batch([
    env.DB!.prepare("INSERT INTO delivery_events (id,order_id,kind,detail,actor,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders o JOIN couriers c ON c.id=o.courier_id JOIN members m ON m.user_id=c.user_id WHERE o.id=? AND o.revision=? AND o.courier_id=? AND o.status='confirmed' AND o.fulfillment_mode<>'pickup' AND c.user_id=? AND c.binding_revision=? AND m.role='courier') THEN ? ELSE NULL END,?,?,?,?)").bind(d.requestId,d.orderId,d.revision,c.id,user.userId,c.bindingRevision,d.orderId,d.value,JSON.stringify({note:d.note,courier:o.courierName,request}),user.userId,now),
    env.DB!.prepare('UPDATE orders SET delivery=?,revision=? WHERE id=? AND revision=?').bind(d.value,updated.revision,d.orderId,d.revision),
    env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'courier_delivery_updated',?,?,?)").bind(crypto.randomUUID(),user.userId,d.orderId,JSON.stringify({from:o.delivery,to:d.value,note:d.note}),now),
  ]);}catch(e){if(/UNIQUE|NOT NULL|FOREIGN KEY/.test(String(e))){if(await replay())return json({ok:true});throw new CourierError('CONFLICT',409);}throw e;}
  return json({ok:true});
}
