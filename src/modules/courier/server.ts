import {env} from 'cloudflare:workers';
import {and,eq,inArray,or,lt,ne,asc} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {orders,orderItems,deliveryEvents} from '@/db/schema';
import type {Session} from '../access/domain';
import type {Identity} from '../access/server';
import {today,nextState,type Order} from '../shared/domain';
import {validDay,addDays} from '../menu/domain';
import {courierTask,type CourierTasks} from './domain';
import {orderBalance,paymentError,type Payment} from '../finance/domain';
import {recordPaymentStatements,courierCashOnHand} from '../finance/server';
export class CourierError extends Error{constructor(public code:string,public status=400){super(code);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
/**
 * v51: egyetlen futár van, külön futártörzs és fiók–futár összekötés nélkül. A futár szerepkörű felhasználó
 * az összes kiszállításos feladatot látja, és a rendelésre a saját neve kerül (indulásnál).
 */
function requireCourier(session:Session){if(session.role!=='courier')throw new CourierError('COURIER_ROLE_REQUIRED',403);}
export async function handleCourier(path:string,body:unknown,user:Identity,session:Session,write:boolean,date:string):Promise<Response>{
  const db=getDb(),now=new Date().toISOString();
  requireCourier(session);
  if(!write&&path==='/api/courier/tasks'){
    if(!validDay(date)||date<addDays(today(),-30)||date>addDays(today(),30))throw new CourierError('COURIER_DATE');
    const scope=and(eq(orders.status,'confirmed'),ne(orders.fulfillmentMode,'pickup'),or(eq(orders.date,date),eq(orders.delivery,'transit'),and(lt(orders.date,today()),ne(orders.delivery,'delivered'))));
    const rows=await db.select().from(orders).where(scope).orderBy(asc(orders.date),asc(orders.time));
    const ids=rows.map(o=>o.id);
    const [itemRows,eventRows]=ids.length?await Promise.all([db.select({item:orderItems}).from(orderItems).innerJoin(orders,eq(orders.id,orderItems.orderId)).where(scope),db.select({event:deliveryEvents}).from(deliveryEvents).innerJoin(orders,eq(orders.id,deliveryEvents.orderId)).where(and(scope,inArray(deliveryEvents.kind,['transit','delivered','failed'])))]):[[],[]];
    const items=itemRows.map(r=>r.item),events=eventRows.map(r=>r.event);
    // v76: a beszedendő összeghez a rendelés végösszege és befizetései kellenek (árak a futárnak nem jelennek meg, csak a hátralék).
    const payRows=ids.length?(await env.DB!.prepare("SELECT order_id AS orderId,amount FROM payments WHERE order_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<Pick<Payment,'orderId'|'amount'>>()).results:[];
    const cashOnHand=await courierCashOnHand(user.userId);
    const data:CourierTasks={date,cashOnHand,courier:{name:session.name,vehicle:''},tasks:rows.map(o=>{const own=items.filter(i=>i.orderId===o.id),totalDue=own.reduce((s,i)=>s+i.price*i.quantity,0)+(o.deliveryFee??0),pays=payRows.filter(p=>p.orderId===o.id);const task={...courierTask({...o,items:own} as Order),due:orderBalance(totalDue,pays,o.payment==='paid').due};return {...task,events:events.filter(e=>e.orderId===o.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(e=>{let note='';try{note=String(JSON.parse(e.detail).note??'');}catch{}return {kind:e.kind,note,createdAt:e.createdAt};})};})};
    return json(data);
  }
  if(!write||path!=='/api/courier/state')return json({error:'NOT_FOUND'},404);
  const d=z.object({requestId:z.string().uuid(),orderId:z.string().min(1).max(200),revision:z.number().int().min(0),value:z.enum(['transit','delivered','failed']),note:z.string().trim().max(500),payment:z.object({method:z.enum(['cash','card']),amount:z.number().int().min(1).max(100_000_000)}).strict().nullable().optional()}).strict().parse(body),request=JSON.stringify(d);
  const [o]=await db.select().from(orders).where(and(eq(orders.id,d.orderId),eq(orders.status,'confirmed'),ne(orders.fulfillmentMode,'pickup')));if(!o)throw new CourierError('NOT_FOUND',404);
  async function replay(){const [event]=await db.select().from(deliveryEvents).where(eq(deliveryEvents.id,d.requestId));if(!event)return false;let saved;try{saved=JSON.parse(event.detail).request;}catch{}if(event.actor!==user.userId||saved!==request)throw new CourierError('CONFLICT',409);return true;}
  if(await replay())return json({ok:true});
  if(o.revision!==d.revision)throw new CourierError('CONFLICT',409);
  if(d.value==='failed'&&!d.note)throw new CourierError('DELIVERY_REASON_REQUIRED');
  const updated=nextState({...o,items:[]} as Order,'delivery',d.value);
  // v76: kézbesítéskor a beszedett összeg ugyanabban a kötegben rögzül (csak 'delivered'-nél).
  if(d.payment&&d.value!=='delivered')throw new CourierError('VALIDATION');
  if(d.payment){const due=(await env.DB!.prepare("SELECT o.payment,o.delivery_fee+COALESCE((SELECT SUM(price*quantity) FROM order_items WHERE order_id=o.id),0) AS total,(SELECT COUNT(*) FROM payments WHERE order_id=o.id) AS n,COALESCE((SELECT SUM(amount) FROM payments WHERE order_id=o.id),0) AS paid FROM orders o WHERE o.id=?").bind(d.orderId).first<{payment:string;total:number;n:number;paid:number}>())!;const err=paymentError(d.payment.amount,due.payment==='paid'&&due.n===0?0:Math.max(0,due.total-due.paid));if(err)throw new CourierError(err);}
  const paymentStatements=d.payment?recordPaymentStatements({orderId:d.orderId,method:d.payment.method,amount:d.payment.amount,collectedBy:'courier',collectorId:user.userId,collectorName:session.name.slice(0,200),note:'',now}):[];
  // Induláskor a futár neve kerül a rendelésre (egyszerű szöveg, nincs összekötés).
  const courierName=d.value==='transit'?session.name.slice(0,200):o.courierName;
  try{await env.DB!.batch([
    env.DB!.prepare("INSERT INTO delivery_events (id,order_id,kind,detail,actor,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders o, members m WHERE o.id=? AND o.revision=? AND o.status='confirmed' AND o.fulfillment_mode<>'pickup' AND m.user_id=? AND m.role='courier') THEN ? ELSE NULL END,?,?,?,?)").bind(d.requestId,d.orderId,d.revision,user.userId,d.orderId,d.value,JSON.stringify({note:d.note,courier:courierName,request}),user.userId,now),
    env.DB!.prepare('UPDATE orders SET delivery=?,courier_name=?,revision=? WHERE id=? AND revision=?').bind(d.value,courierName,updated.revision,d.orderId,d.revision),
    ...paymentStatements,
    env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'courier_delivery_updated',?,?,?)").bind(crypto.randomUUID(),user.userId,d.orderId,JSON.stringify({from:o.delivery,to:d.value,note:d.note}),now),
  ]);}catch(e){if(/UNIQUE|NOT NULL|FOREIGN KEY/.test(String(e))){if(await replay())return json({ok:true});throw new CourierError('CONFLICT',409);}throw e;}
  return json({ok:true});
}
