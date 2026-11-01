import {env} from 'cloudflare:workers';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {fulfillmentPolicy,orders} from '@/db/schema';
import {today} from '../shared/domain';
import {validDay,addDays,kitchenWallTime,cutoffInstant} from '../menu/domain';
import {emptyPolicy,validatePolicy,slotIdentity,closedDay,isoWeekday,orderFulfillment,type PolicyData,type FulfillmentPolicy} from './domain';
export class FulfillmentError extends Error{constructor(public code:string,public status=400){super(code);}}
const money=z.number().int().min(0).max(100000000),time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),days=z.array(z.number().int().min(1).max(7)).max(7).refine(v=>new Set(v).size===v.length);
const policySchema=z.object({deliveryEnabled:z.boolean(),pickupEnabled:z.boolean(),pickupHu:z.string().trim().max(500),pickupRo:z.string().trim().max(500),pickupMinimum:money,closedWeekdays:days,closedDates:z.array(z.string().refine(validDay)).max(100),zones:z.array(z.object({id:z.string().uuid(),hu:z.string().trim().min(1).max(100),ro:z.string().trim().min(1).max(100),postcodes:z.array(z.string().regex(/^\d{6}$/)).min(1).max(100),fee:money,minimum:money,active:z.boolean()}).strict()).max(15),slots:z.array(z.object({id:z.string().uuid(),mode:z.enum(['delivery','pickup']),weekdays:days.refine(v=>v.length>0),start:time,end:time,capacity:z.number().int().min(0).max(10000).optional(),active:z.boolean()}).strict()).max(30)}).strict();
export async function loadPolicy():Promise<PolicyData>{const [row]=await getDb().select().from(fulfillmentPolicy).where(eq(fulfillmentPolicy.id,1));return row?{revision:row.revision,policy:JSON.parse(row.content) as FulfillmentPolicy}:{revision:null,policy:emptyPolicy};}
/** Azok az idősávok, amelyekre már van (bármilyen állapotú) rendelés: ezek ideje, napjai és módja nem írható át. */
export async function bookedSlotIds():Promise<string[]>{const rows=await env.DB!.prepare('SELECT DISTINCT fulfillment_slot_id AS slotId FROM orders WHERE fulfillment_slot_id IS NOT NULL').all();return rows.results.map(r=>String(r.slotId));}
export async function fulfillmentOptions(date:string){
  if(!validDay(date)||date<today()||date>addDays(today(),30))throw new FulfillmentError('FULFILLMENT_DATE');
  const data=await loadPolicy(),p=data.policy,closed=data.revision===null||closedDay(p,date),local=kitchenWallTime();
  return {...data,date,closed,slots:closed?[]:p.slots.filter(s=>s.active&&s.weekdays.includes(isoWeekday(date))&&(s.mode==='pickup'?p.pickupEnabled:p.deliveryEnabled)&&date+'T'+s.start>local&&cutoffInstant(date+'T'+s.start)&&cutoffInstant(date+'T'+s.end)).map(({capacity:_unused,...s})=>s)};
}
export async function savePolicy(body:unknown,actor:string){
  const d=z.object({revision:z.number().int().min(0).nullable(),policy:policySchema}).strict().parse(body),current=await loadPolicy();
  if(d.revision!==current.revision)throw new FulfillmentError('CONFLICT',409);
  try{validatePolicy(d.policy);}catch(e){throw new FulfillmentError((e as Error).message);}
  const booked=await getDb().select({slotId:orders.fulfillmentSlotId,snapshot:orders.fulfillmentSnapshot}).from(orders);
  // Foglalás nélküli idősáv átírható; foglalt idősáv ideje, napjai és módja nem.
  const changed=d.policy.slots.filter(s=>{const old=current.policy.slots.find(old=>old.id===s.id);return !!old&&slotIdentity(old)!==slotIdentity(s);}).map(s=>s.id);
  if(changed.some(id=>booked.some(o=>o.slotId===id)))throw new FulfillmentError('FULFILLMENT_SLOT_ID');
  for(const s of d.policy.slots){if(booked.some(o=>o.slotId===s.id&&o.snapshot&&slotIdentity(orderFulfillment({fulfillmentSnapshot:o.snapshot})!)!==slotIdentity(s)))throw new FulfillmentError('FULFILLMENT_SLOT_ID');}
  const content=JSON.stringify({...d.policy,slots:d.policy.slots.map(({capacity:_unused,...s})=>s)}),now=new Date().toISOString();
  try{await env.DB!.batch([
    env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN ${d.revision===null?'NOT EXISTS (SELECT 1 FROM fulfillment_policy WHERE id=1)':'EXISTS (SELECT 1 FROM fulfillment_policy WHERE id=1 AND revision=?)'} THEN ? ELSE NULL END,'fulfillment_updated','policy','',?)`).bind(crypto.randomUUID(),...(d.revision===null?[]:[d.revision]),actor,now),
    // Ha közben foglalás érkezett egy átírt idősávra, a NULL szereplő miatt az egész mentés visszagörgetődik.
    ...(changed.length?[env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN NOT EXISTS (SELECT 1 FROM orders WHERE fulfillment_slot_id IN (SELECT value FROM json_each(?))) THEN ? ELSE NULL END,'fulfillment_slot_changed','policy',?,?)").bind(crypto.randomUUID(),JSON.stringify(changed),actor,changed.join(','),now)]:[]),
    ...(d.revision===null?[env.DB!.prepare('INSERT INTO fulfillment_policy (id,revision,content) VALUES (1,0,?)').bind(content)]:[env.DB!.prepare('UPDATE fulfillment_policy SET content=?,revision=revision+1 WHERE id=1 AND revision=?').bind(content,d.revision)]),
  ]);}catch(e){if(/UNIQUE|NOT NULL/.test(String(e)))throw new FulfillmentError('FULFILLMENT_CONFLICT',409);throw e;}
  return {ok:true};
}
