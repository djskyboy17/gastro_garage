import {env} from 'cloudflare:workers';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {fulfillmentPolicy} from '@/db/schema';
import {today} from '../shared/domain';
import {validDay,addDays} from '../menu/domain';
import {emptyPolicy,validatePolicy,closedDay,normalizePolicy,orderUntilAt,type PolicyData} from './domain';
export class FulfillmentError extends Error{constructor(public code:string,public status=400){super(code);}}
const money=z.number().int().min(0).max(100000000),days=z.array(z.number().int().min(1).max(7)).max(7).refine(v=>new Set(v).size===v.length);
// v58: a körzet név szerint választható (nincs irányítószám), és nincsenek heti idősávok.
const policySchema=z.object({deliveryEnabled:z.boolean(),pickupEnabled:z.boolean(),pickupHu:z.string().trim().max(500),pickupRo:z.string().trim().max(500),pickupMinimum:money,orderUntil:z.union([z.literal(''),z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]),closedWeekdays:days,closedDates:z.array(z.string().refine(validDay)).max(100),zones:z.array(z.object({id:z.string().uuid(),hu:z.string().trim().min(1).max(100),ro:z.string().trim().min(1).max(100),fee:money,minimum:money,active:z.boolean()}).strict()).max(30)}).strict();
export async function loadPolicy():Promise<PolicyData>{const [row]=await getDb().select().from(fulfillmentPolicy).where(eq(fulfillmentPolicy.id,1));return row?{revision:row.revision,policy:normalizePolicy(JSON.parse(row.content))}:{revision:null,policy:emptyPolicy};}
export async function fulfillmentOptions(date:string){
  if(!validDay(date)||date<today()||date>addDays(today(),30))throw new FulfillmentError('FULFILLMENT_DATE');
  const data=await loadPolicy(),closed=data.revision===null||closedDay(data.policy,date),until=orderUntilAt(data.policy,date);
  // v61: a rendelési határidő után aznapra már nem lehet rendelni (a napi menü határidejétől függetlenül).
  return {...data,date,closed,orderUntilAt:until,ordersClosed:closed||(!!until&&Date.now()>=Date.parse(until))};
}
export async function savePolicy(body:unknown,actor:string){
  const d=z.object({revision:z.number().int().min(0).nullable(),policy:policySchema}).strict().parse(body),current=await loadPolicy();
  if(d.revision!==current.revision)throw new FulfillmentError('CONFLICT',409);
  try{validatePolicy(d.policy);}catch(e){throw new FulfillmentError((e as Error).message);}
  const content=JSON.stringify(d.policy),now=new Date().toISOString();
  try{await env.DB!.batch([
    env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN ${d.revision===null?'NOT EXISTS (SELECT 1 FROM fulfillment_policy WHERE id=1)':'EXISTS (SELECT 1 FROM fulfillment_policy WHERE id=1 AND revision=?)'} THEN ? ELSE NULL END,'fulfillment_updated','policy','',?)`).bind(crypto.randomUUID(),...(d.revision===null?[]:[d.revision]),actor,now),
    ...(d.revision===null?[env.DB!.prepare('INSERT INTO fulfillment_policy (id,revision,content) VALUES (1,0,?)').bind(content)]:[env.DB!.prepare('UPDATE fulfillment_policy SET content=?,revision=revision+1 WHERE id=1 AND revision=?').bind(content,d.revision)]),
  ]);}catch(e){if(/UNIQUE|NOT NULL/.test(String(e)))throw new FulfillmentError('FULFILLMENT_CONFLICT',409);throw e;}
  return {ok:true};
}
