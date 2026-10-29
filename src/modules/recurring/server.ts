import {env} from "cloudflare:workers";
import {eq,desc} from "drizzle-orm";
import {z} from "zod";
import {getDb} from "@/db";
import {recurringTemplates,recurringOccurrences,recurringRuns,customers,products,recipes} from "@/db/schema";
import {today} from "../shared/domain";
import {matchingDates,recurringOrderId,validDate,type RecurringData,type RecurringTemplate,type RecurringPreview} from "./domain";
export class RecurringError extends Error {constructor(public code:string,public status=400){super(code);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
const date=z.string().refine(validDate);
const templateInput=z.object({id:z.string().uuid(),revision:z.number().int().min(0).optional(),name:z.string().trim().min(1).max(200),customerId:z.string().min(1).max(200),start:date,end:date,time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),weekdays:z.array(z.number().int().min(1).max(7)).min(1).max(7),excludedDates:z.array(date).max(100),note:z.string().trim().max(1500),items:z.array(z.object({productId:z.string().min(1).max(200),quantity:z.number().int().min(1).max(1000)})).min(1).max(10),active:z.number().int().min(0).max(1)});
const rangeInput=z.object({templateId:z.string().uuid(),revision:z.number().int().min(0),from:date,to:date});
function unpack(row:typeof recurringTemplates.$inferSelect):RecurringTemplate{const{content,...rest}=row;return {...rest,...JSON.parse(content)};}
export async function loadRecurring():Promise<RecurringData>{const db=getDb();const[t,o]=await Promise.all([db.select().from(recurringTemplates).orderBy(desc(recurringTemplates.createdAt)),db.select().from(recurringOccurrences)]);return {templates:t.map(unpack),occurrences:o};}
async function preview(d:z.infer<typeof rangeInput>):Promise<RecurringPreview>{
  const db=getDb();
  const [row]=await db.select().from(recurringTemplates).where(eq(recurringTemplates.id,d.templateId));
  if(!row)throw new RecurringError("NOT_FOUND",404);
  if(row.revision!==d.revision)throw new RecurringError("CONFLICT",409);
  if(!row.active)throw new RecurringError("RECURRING_PAUSED");
  if(d.from<today())throw new RecurringError("RECURRING_PAST");
  const template=unpack(row),dates=matchingDates(template,d.from,d.to);
  const [[customer],catalog,recipeList,occurrences]=await Promise.all([db.select().from(customers).where(eq(customers.id,template.customerId)),db.select().from(products),db.select().from(recipes),db.select().from(recurringOccurrences).where(eq(recurringOccurrences.templateId,template.id))]);
  if(!customer)throw new RecurringError("CUSTOMER_MISSING");
  const items=template.items.map(i=>{
    const p=catalog.find(p=>p.id===i.productId&&p.active);if(!p)throw new RecurringError("RECURRING_PRODUCT_INACTIVE");
    const recipe=recipeList.filter(r=>r.productId===p.id).sort((a,b)=>b.version-a.version)[0];
    return {productId:p.id,hu:p.hu,ro:p.ro,allergens:p.allergens,quantity:i.quantity,price:p.price,recipeId:recipe?.id??null};
  });
  const canonical={templateId:template.id,revision:template.revision,from:d.from,to:d.to,customerId:customer.id,customerName:customer.name,address:customer.address,phone:customer.phone,time:template.time,note:template.note,items,dates};
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(canonical)));
  const quote=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  return {...canonical,quote,days:dates.map(day=>({date:day,orderId:recurringOrderId(template.id,day),existingOrderId:occurrences.find(o=>o.day===day)?.orderId??null})),totalPerOrder:items.reduce((s,i)=>s+i.quantity*i.price,0)};
}
export async function handleRecurring(path:string,body:unknown,actor:string):Promise<Response|null>{
  if(!path.startsWith("/api/recurring/"))return null;
  const db=getDb(),now=new Date().toISOString();
  if(path==="/api/recurring/templates"){
    const d=templateInput.parse(body);
    if(d.start>d.end||new Set(d.weekdays).size!==d.weekdays.length||new Set(d.items.map(i=>i.productId)).size!==d.items.length||new Set(d.excludedDates).size!==d.excludedDates.length||d.excludedDates.some(day=>day<d.start||day>d.end))throw new RecurringError("VALIDATION");
    d.weekdays.sort((a,b)=>a-b);d.excludedDates.sort();
    const {id,revision,name,customerId,active,...content}=d,serialized=JSON.stringify(content);
    const [old]=await db.select().from(recurringTemplates).where(eq(recurringTemplates.id,id));
    if(old&&revision===undefined){if(old.content===serialized&&old.name===name&&old.customerId===customerId&&old.active===active)return json({ok:true,id});throw new RecurringError("CONFLICT",409);}
    if(old?.revision!==revision)throw new RecurringError("CONFLICT",409);
    const [customer]=await db.select().from(customers).where(eq(customers.id,customerId));if(!customer)throw new RecurringError("CUSTOMER_MISSING");
    const catalog=await db.select().from(products);if(content.items.some(i=>!catalog.some(p=>p.id===i.productId&&p.active)))throw new RecurringError("RECURRING_PRODUCT_INACTIVE");
    if(old){
      const result=await env.DB!.batch([
        env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'recurring_updated',?,?,? WHERE EXISTS (SELECT 1 FROM recurring_templates WHERE id=? AND revision=?)").bind(crypto.randomUUID(),actor,id,name,now,id,revision!),
        env.DB!.prepare("UPDATE recurring_templates SET name=?,customer_id=?,content=?,active=?,revision=revision+1 WHERE id=? AND revision=?").bind(name,customerId,serialized,active,id,revision!),
      ]);if(result[1].meta.changes!==1)throw new RecurringError("CONFLICT",409);return json({ok:true,id});
    }
    await env.DB!.batch([env.DB!.prepare("INSERT INTO recurring_templates (id,name,customer_id,content,active,revision,created_at) VALUES (?,?,?,?,?,0,?)").bind(id,name,customerId,serialized,active,now),env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'recurring_created',?,?,?)").bind(crypto.randomUUID(),actor,id,name,now)]);
    return json({ok:true,id},201);
  }
  if(path==="/api/recurring/preview")return json(await preview(rangeInput.parse(body)));
  if(path!=="/api/recurring/generate")return json({error:"NOT_FOUND"},404);
  const d=rangeInput.extend({id:z.string().uuid(),quote:z.string().regex(/^[a-f0-9]{64}$/)}).parse(body),request=JSON.stringify(d);
  async function replay(){
    const [run]=await db.select().from(recurringRuns).where(eq(recurringRuns.id,d.id));if(!run)return null;
    if(run.request!==request)throw new RecurringError("CONFLICT",409);
    const occurrences=await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.runId,d.id));return {ok:true,created:occurrences.length,skipped:run.requestedCount-occurrences.length,orderIds:occurrences.map(o=>o.orderId)};
  }
  const old=await replay();if(old)return json(old);
  const plan=await preview(d);
  if(plan.quote!==d.quote)throw new RecurringError("RECURRING_PREVIEW_CHANGED",409);
  if(!plan.days.length)throw new RecurringError("RECURRING_EMPTY");
  const [template]=await db.select().from(recurringTemplates).where(eq(recurringTemplates.id,d.templateId));
  const rows=plan.days.map(day=>({id:day.orderId,date:day.date}));
  const itemRows=plan.days.flatMap(day=>plan.items.map((item,index)=>({...item,id:day.orderId+":"+index,orderId:day.orderId})));
  try{
    await env.DB!.batch([
      env.DB!.prepare("INSERT INTO recurring_runs (id,template_id,request,requested_count,actor,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM recurring_templates WHERE id=? AND revision=? AND active=1) THEN ? ELSE NULL END,?,?,?,?)").bind(d.id,d.templateId,d.revision,d.templateId,request,plan.days.length,actor,now),
      env.DB!.prepare("INSERT INTO orders (id,customer_id,customer_name,address,phone,date,time,note,production,delivery,payment,status,revision,created_at) SELECT json_extract(value,'$.id'),?,?,?,?,json_extract(value,'$.date'),?,?,'queued','pending','unpaid','confirmed',0,? FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM recurring_occurrences WHERE template_id=? AND day=json_extract(value,'$.date'))").bind(template.customerId,plan.customerName,plan.address,plan.phone,plan.time,plan.note,now,JSON.stringify(rows),d.templateId),
      env.DB!.prepare("INSERT INTO recurring_occurrences (id,template_id,day,order_id,run_id,template_revision) SELECT ? || ':' || json_extract(value,'$.date'),?,json_extract(value,'$.date'),json_extract(value,'$.id'),?,? FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM recurring_occurrences WHERE template_id=? AND day=json_extract(value,'$.date'))").bind(d.templateId,d.templateId,d.id,d.revision,JSON.stringify(rows),d.templateId),
      env.DB!.prepare("INSERT INTO order_items (id,order_id,product_id,hu,ro,allergens,quantity,price,recipe_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.orderId'),json_extract(value,'$.productId'),json_extract(value,'$.hu'),json_extract(value,'$.ro'),json_extract(value,'$.allergens'),json_extract(value,'$.quantity'),json_extract(value,'$.price'),json_extract(value,'$.recipeId') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM recurring_occurrences WHERE order_id=json_extract(value,'$.orderId') AND run_id=?)").bind(JSON.stringify(itemRows),d.id),
      env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT 'recurring-order:' || order_id,?,'order_created',order_id,?,? FROM recurring_occurrences WHERE run_id=?").bind(actor,plan.customerName,now,d.id),
      env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'recurring_generated',?,?,?)").bind(crypto.randomUUID(),actor,d.templateId,JSON.stringify({runId:d.id,from:d.from,to:d.to}),now),
    ]);
  }catch(e){
    if(/UNIQUE|NOT NULL|FOREIGN KEY/.test(String(e))){const duplicate=await replay();if(duplicate)return json(duplicate);throw new RecurringError("CONFLICT",409);}throw e;
  }
  return json(await replay(),201);
}
