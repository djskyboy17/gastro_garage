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
const policySchema=z.object({deliveryEnabled:z.boolean(),pickupEnabled:z.boolean(),pickupHu:z.string().trim().max(500),pickupRo:z.string().trim().max(500),pickupMinimum:money,closedWeekdays:days,closedDates:z.array(z.string().refine(validDay)).max(100),zones:z.array(z.object({id:z.string().uuid(),hu:z.string().trim().min(1).max(100),ro:z.string().trim().min(1).max(100),postcodes:z.array(z.string().regex(/^\d{6}$/)).min(1).max(100),fee:money,minimum:money,active:z.boolean()}).strict()).max(15),slots:z.array(z.object({id:z.string().uuid(),mode:z.enum(['delivery','pickup']),weekdays:days.refine(v=>v.length>0),start:time,end:time,capacity:z.number().int().min(0).max(10000),active:z.boolean()}).strict()).max(30)}).strict();
export async function loadPolicy():Promise<PolicyData>{const [row]=await getDb().select().from(fulfillmentPolicy).where(eq(fulfillmentPolicy.id,1));return row?{revision:row.revision,policy:JSON.parse(row.content) as FulfillmentPolicy}:{revision:null,policy:emptyPolicy};}
export async function fulfillmentOptions(date:string){
  if(!validDay(date)||date<today()||date>addDays(today(),30))throw new FulfillmentError('FULFILLMENT_DATE');
  const data=await loadPolicy(),p=data.policy,closed=data.revision===null||closedDay(p,date),local=kitchenWallTime();
  const rows=await env.DB!.prepare("SELECT fulfillment_slot_id AS slotId,count(*) AS used FROM orders WHERE date=? AND status IN ('requested','confirmed') AND fulfillment_slot_id IS NOT NULL GROUP BY fulfillment_slot_id").bind(date).all();
  return {...data,date,closed,slots:closed?[]:p.slots.filter(s=>s.active&&s.weekdays.includes(isoWeekday(date))&&(s.mode==='pickup'?p.pickupEnabled:p.deliveryEnabled)&&date+'T'+s.start>local&&cutoffInstant(date+'T'+s.start)&&cutoffInstant(date+'T'+s.end)).map(s=>({...s,remaining:Math.max(0,s.capacity-Number(rows.results.find(r=>r.slotId===s.id)?.used??0))}))};
}
export async function savePolicy(body:unknown,actor:string){
  const d=z.object({revision:z.number().int().min(0).nullable(),policy:policySchema}).strict().parse(body),current=await loadPolicy();
  if(d.revision!==current.revision)throw new FulfillmentError('CONFLICT',409);
  try{validatePolicy(d.policy);}catch(e){throw new FulfillmentError((e as Error).message);}
  for(const s of d.policy.slots){const old=current.policy.slots.find(old=>old.id===s.id);if(old&&slotIdentity(old)!==slotIdentity(s))throw new FulfillmentError('FULFILLMENT_SLOT_ID');}
  const booked=await getDb().select({slotId:orders.fulfillmentSlotId,snapshot:orders.fulfillmentSnapshot}).from(orders);
  for(const s of d.policy.slots){if(booked.some(o=>o.slotId===s.id&&o.snapshot&&slotIdentity(orderFulfillment({fulfillmentSnapshot:o.snapshot})!)!==slotIdentity(s)))throw new FulfillmentError('FULFILLMENT_SLOT_ID');}
  const content=JSON.stringify(d.policy),now=new Date().toISOString();
  try{await env.DB!.batch([
    env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN ${d.revision===null?'NOT EXISTS (SELECT 1 FROM fulfillment_policy WHERE id=1)':'EXISTS (SELECT 1 FROM fulfillment_policy WHERE id=1 AND revision=?)'} THEN ? ELSE NULL END,'fulfillment_updated','policy','',?)`).bind(crypto.randomUUID(),...(d.revision===null?[]:[d.revision]),actor,now),
    env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(?,'$.slots') s JOIN orders o ON o.fulfillment_slot_id=json_extract(s.value,'$.id') WHERE o.date>=? AND o.status IN ('requested','confirmed') GROUP BY o.date,o.fulfillment_slot_id HAVING count(*)>CAST(json_extract(s.value,'$.capacity') AS INTEGER)) THEN ? ELSE NULL END,'fulfillment_capacity_checked','policy','',?)").bind(crypto.randomUUID(),content,today(),actor,now),
    ...(d.revision===null?[env.DB!.prepare('INSERT INTO fulfillment_policy (id,revision,content) VALUES (1,0,?)').bind(content)]:[env.DB!.prepare('UPDATE fulfillment_policy SET content=?,revision=revision+1 WHERE id=1 AND revision=?').bind(content,d.revision)]),
  ]);}catch(e){if(/UNIQUE|NOT NULL/.test(String(e)))throw new FulfillmentError('FULFILLMENT_CONFLICT',409);throw e;}
  return {ok:true};
}
