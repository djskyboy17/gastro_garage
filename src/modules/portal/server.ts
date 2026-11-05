import {loadPolicy,fulfillmentOptions} from "../fulfillment/server";
import {quoteFulfillment,orderUntilAt} from "../fulfillment/domain";
import {cutoffInstant,kitchenWallTime} from "../menu/domain";
import {menuDays} from '@/db/schema';
import {publicMenu} from '../menu/server';
import {env} from "cloudflare:workers";
import {and,eq,ne,desc,gte,sql} from "drizzle-orm";
import {z} from "zod";
import {getDb} from "@/db";
import {products,customers,orders,orderItems,portalProfiles,portalSubmissions,recipes} from "@/db/schema";
import {isAdmin,type Session} from "../access/domain";
import type {Identity} from "../access/server";
import {publicProduct,publicOrder,validPortalSlot,type PortalData,type PortalAccount,type PortalPreview} from "./domain";
import {publicDishInfos} from "../inventory/server";
import {today,SET_CART_ID,SET_GROUP,splitSetPrice} from "../shared/domain";
import {hardDeleteOrder} from "../shared/order-delete";
import {groupRows} from "../shared/collections";
export class PortalError extends Error {constructor(public code:string,public status=400){super(code);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
const profileInput=z.object({revision:z.number().int().min(0).optional(),name:z.string().trim().min(1).max(200),address:z.string().trim().max(500).refine(v=>v.length===0||v.length>=5),phone:z.string().trim().regex(/^[+0-9 ()-]{6,40}$/)}).strict();
// v58: körzet név szerint (zoneId; átvételnél üres), idősáv helyett kívánt időpont (üres = minél előbb).
const orderInput=z.object({expectedPaymentMethod:z.enum(["","cash","card"]).default(""),mode:z.enum(["delivery","pickup"]),zoneId:z.string().max(100),date:z.string(),time:z.string().max(5),note:z.string().trim().max(1500),items:z.array(z.object({productId:z.string().min(1).max(200),quantity:z.number().int().min(1).max(100)}).strict()).min(1).max(10)}).strict();
/** Az ügyfélnek látható kínálat: az aktív ételek, amelyek rajta vannak egy mai vagy későbbi, nyitott étlapon (v27). */
export async function loadPublicCatalog(){
  const onMenu=await env.DB!.prepare("SELECT DISTINCT l.product_id AS id FROM menu_lines l JOIN menu_days d ON d.date=l.date WHERE d.active=1 AND l.date>=?").bind(today()).all<{id:string}>();
  const ids=new Set(onMenu.results.map(r=>r.id));
  const rows=(await getDb().select().from(products).where(eq(products.active,1))).filter(p=>ids.has(p.id));
  const infos=await publicDishInfos(rows);
  return rows.map(p=>({...publicProduct(p),info:infos.get(p.id)??null}));
}
async function account(userId:string){
  const [row]=await getDb().select({userId:portalProfiles.userId,customerId:portalProfiles.customerId,active:portalProfiles.active,revision:portalProfiles.revision,createdAt:portalProfiles.createdAt,name:customers.name,address:customers.address,phone:customers.phone}).from(portalProfiles).innerJoin(customers,eq(customers.id,portalProfiles.customerId)).where(eq(portalProfiles.userId,userId));
  return row;
}
async function requireAccount(userId:string){const p=await account(userId);if(!p)throw new PortalError("PORTAL_PROFILE_REQUIRED");if(!p.active)throw new PortalError("PORTAL_BLOCKED",403);return p;}
function profile(p:PortalAccount){return {name:p.name,address:p.address,phone:p.phone,revision:p.revision};}
async function quote(input:z.infer<typeof orderInput>,userId:string){
  if(input.time===""?input.date!==today():!validPortalSlot(input.date,input.time))throw new PortalError("PORTAL_SLOT");
  if(new Set(input.items.map(i=>i.productId)).size!==input.items.length)throw new PortalError("VALIDATION");
  const p=await requireAccount(userId),db=getDb();
  const [catalog,recipeList]=await Promise.all([db.select().from(products).where(eq(products.active,1)),db.select().from(recipes)]);
  const line=(productId:string,quantity:number,price:number|null,setGroup:string)=>{const product=catalog.find(p=>p.id===productId);if(!product)throw new PortalError("PORTAL_PRODUCT_UNAVAILABLE");const recipe=recipeList.filter(r=>r.productId===productId).sort((a,b)=>b.version-a.version)[0];return {productId:product.id,hu:product.hu,ro:product.ro,allergens:product.allergens,quantity,price:price??product.price,recipeId:recipe?.id??null,portalRevision:product.portalRevision,setGroup};};
  // A Napi menü részbe tartozó étel csak a menü részeként rendelhető, külön nem (v49).
  if(input.items.some(i=>i.productId!==SET_CART_ID&&catalog.find(p=>p.id===i.productId)?.section==="daily"))throw new PortalError("MENU_SET_ONLY");
  const lines=input.items.filter(i=>i.productId!==SET_CART_ID).map(i=>line(i.productId,i.quantity,null,""));
  const [day]=await db.select().from(menuDays).where(eq(menuDays.date,input.date));
  const menu=await publicMenu(input.date);
  // v54: nem mentett nap is nyitva lehet (Étlap ételei, alapértelmezett határidő).
  if(!menu.open)throw new PortalError("MENU_CLOSED");
  // Napi menü (v49): egy kosártétel, ami a rendelésben három tételre bomlik (leves, főétel, desszert);
  // a menüár a három tétel között oszlik meg, így a konyha, az adagkorlát és a raktár a valódi ételeket látja.
  const setItem=input.items.find(i=>i.productId===SET_CART_ID);
  if(setItem){
    if(!menu.set)throw new PortalError("MENU_SET_UNAVAILABLE");
    const prices=splitSetPrice(menu.set.price);
    lines.unshift(...[menu.set.soup,menu.set.main].map((p,i)=>line(p.id,setItem.quantity,prices[i]!,SET_GROUP)));
  }
  for(const l of lines)if(!menu.items.some(i=>i.id===l.productId))throw new PortalError("MENU_PRODUCT");
  // Adagkorlát ételenként: a menüben és külön rendelt adagok együtt.
  for(const offer of menu.items){const wanted=lines.filter(l=>l.productId===offer.id).reduce((s,l)=>s+l.quantity,0);if(wanted>offer.remaining)throw new PortalError("MENU_CAPACITY",409);}
  const policyData=await loadPolicy();if(policyData.revision===null)throw new PortalError("FULFILLMENT_DISABLED");
  const subtotal=lines.reduce((s,i)=>s+i.quantity*i.price,0);
  let fulfillment;try{fulfillment=quoteFulfillment(policyData.policy,input,subtotal);}catch(e){throw new PortalError((e as Error).message);}
  if(input.mode==='delivery'&&p.address.length<5)throw new PortalError('FULFILLMENT_ADDRESS');
  if((await fulfillmentOptions(input.date)).closed)throw new PortalError('FULFILLMENT_CLOSED');
  const canonical={expectedPaymentMethod:input.expectedPaymentMethod,policyRevision:policyData.revision,fulfillment,subtotal,menuRevision:day?.revision??null,menuAutoCutoff:day?null:menu.cutoffAt,setPriceRevision:setItem?menu.set!.priceRevision:null,profile:profile(p),date:input.date,time:input.time,note:input.note,items:lines};
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(canonical)));
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  const preview:PortalPreview={...canonical,quote:fingerprint,items:lines.map(({recipeId,portalRevision,...line})=>line),total:subtotal+fulfillment.fee};
  return {preview,p,lines,day,autoCutoff:day?null:menu.cutoffAt,policyRevision:policyData.revision,setPriceRevision:setItem?menu.set!.priceRevision:null,orderUntilAt:orderUntilAt(policyData.policy,input.date)};
}
export async function handlePortal(path:string,body:unknown|undefined,user:Identity,session:Session,write:boolean):Promise<Response>{
  const db=getDb(),now=new Date().toISOString();
  if(session.role==="disabled")throw new PortalError("PORTAL_BLOCKED",403);
  const admin=isAdmin(session.role),manager=admin||session.role==="dispatcher";
  const audit=(action:string,entity:string,detail:string)=>env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),user.userId,action,entity,detail,now);
  if(!write&&path==="/api/portal/me"){
    const p=await account(user.userId);if(p&&!p.active)throw new PortalError("PORTAL_BLOCKED",403);
    // v45: a kiszállított / átvett rendelés eltűnik az ügyfél listájáról, a lemondott / elutasított 1 nap múlva; le sem kérdezzük.
    // A lezárás időpontja a rendelés utolsó naplóbejegyzése (lezárt rendelés később nem változik); napló nélkül a létrehozás ideje.
    const dayAgo=new Date(Date.now()-86400000).toISOString();
    const open=and(eq(orders.portalUserId,user.userId),ne(orders.delivery,"delivered"),sql`(${orders.status} NOT IN ('cancelled','rejected') OR ${orders.createdAt}>=${dayAgo} OR EXISTS (SELECT 1 FROM audit a WHERE a.entity=${orders.id} AND a.created_at>=${dayAgo}))`);
    const mine=await db.select().from(orders).where(open).orderBy(desc(orders.createdAt));
    const items=mine.length?(await db.select({item:orderItems}).from(orderItems).innerJoin(orders,eq(orders.id,orderItems.orderId)).where(open)).map(r=>r.item):[];
    const itemsByOrder=groupRows(items,i=>i.orderId);
    const data:PortalData={profile:p?profile(p):null,orders:mine.map(o=>publicOrder({...o,items:itemsByOrder.get(o.id)??[]}))};return json(data);
  }
  if(!write&&path==="/api/portal/accounts"){
    if(!manager)throw new PortalError("FORBIDDEN",403);
    const rows=await db.select({userId:portalProfiles.userId,customerId:portalProfiles.customerId,active:portalProfiles.active,revision:portalProfiles.revision,createdAt:portalProfiles.createdAt,name:customers.name,address:customers.address,phone:customers.phone}).from(portalProfiles).innerJoin(customers,eq(customers.id,portalProfiles.customerId));return json(rows);
  }
  if(!write) return json({error:"NOT_FOUND"},404);
  if(path==="/api/portal/accounts/state"){
    if(!admin)throw new PortalError("FORBIDDEN",403);
    const d=z.object({userId:z.string().min(1).max(200),revision:z.number().int().min(0),active:z.number().int().min(0).max(1)}).strict().parse(body);
    const result=await env.DB!.batch([
      env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'portal_account_updated',?,?,? WHERE EXISTS (SELECT 1 FROM portal_profiles WHERE user_id=? AND revision=?)").bind(crypto.randomUUID(),user.userId,d.userId,String(d.active),now,d.userId,d.revision),
      env.DB!.prepare("UPDATE portal_profiles SET active=?,revision=revision+1 WHERE user_id=? AND revision=?").bind(d.active,d.userId,d.revision),
    ]);if(result[1].meta.changes!==1)throw new PortalError("CONFLICT",409);return json({ok:true});
  }
  if(path==="/api/portal/profile"){
    const d=profileInput.parse(body),old=await account(user.userId);
    if(old&&!old.active)throw new PortalError("PORTAL_BLOCKED",403);
    if(old&&d.revision===undefined){if(d.name===old.name&&d.address===old.address&&d.phone===old.phone)return json({ok:true});throw new PortalError("CONFLICT",409);}
    if(old&&d.revision!==old.revision)throw new PortalError("CONFLICT",409);
    if(!old&&d.revision!==undefined)throw new PortalError("CONFLICT",409);
    try{
      if(old){
        await env.DB!.batch([
          env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM portal_profiles WHERE user_id=? AND revision=? AND active=1) THEN ? ELSE NULL END,'portal_profile_updated',?,'',?)").bind(crypto.randomUUID(),user.userId,d.revision!,user.userId,old.customerId,now),
          env.DB!.prepare("UPDATE customers SET name=?,address=?,phone=? WHERE id=?").bind(d.name,d.address,d.phone,old.customerId),
          env.DB!.prepare("UPDATE portal_profiles SET revision=revision+1 WHERE user_id=? AND revision=?").bind(user.userId,d.revision!),
        ]);
      }else{
        const customerId=crypto.randomUUID();
        await env.DB!.batch([env.DB!.prepare("INSERT INTO customers (id,name,address,phone,note) VALUES (?,?,?,?,'')").bind(customerId,d.name,d.address,d.phone),env.DB!.prepare("INSERT INTO portal_profiles (user_id,customer_id,active,revision,created_at) VALUES (?,?,1,0,?)").bind(user.userId,customerId,now),audit("portal_profile_created",customerId,"")]);
      }
    }catch(e){if(/UNIQUE|NOT NULL|FOREIGN KEY/.test(String(e))){const current=await account(user.userId);if(!old&&current?.name===d.name&&current.address===d.address&&current.phone===d.phone)return json({ok:true});throw new PortalError("CONFLICT",409);}throw e;}
    return json({ok:true},old?200:201);
  }
  if(path==="/api/portal/preview")return json((await quote(orderInput.parse(body),user.userId)).preview);
  if(path==="/api/portal/cancel"){
    await requireAccount(user.userId);
    const d=z.object({id:z.string().uuid(),revision:z.number().int().min(0)}).strict().parse(body);
    const [o]=await db.select().from(orders).where(and(eq(orders.id,d.id),eq(orders.portalUserId,user.userId)));
    // v50: a lemondott rendelés véglegesen törlődik; ismételt kérésre (már törölve) is ok.
    if(!o)return json({ok:true});
    if(o.status!=="requested"&&o.status!=="cancelled")throw new PortalError("PORTAL_CANCEL_DENIED");
    if(o.revision!==d.revision)throw new PortalError("CONFLICT",409);
    const deleted=await hardDeleteOrder(d.id,"EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status IN ('requested','cancelled') AND production='queued' AND portal_user_id=?)",[d.id,d.revision,user.userId]);
    if(!deleted)throw new PortalError("CONFLICT",409);
    return json({ok:true});
  }
  if(path!=="/api/portal/orders")return json({error:"NOT_FOUND"},404);
  const d=orderInput.extend({id:z.string().uuid(),quote:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(body),request=JSON.stringify(d),key=user.userId+":"+d.id;
  async function replay(){const [old]=await db.select().from(portalSubmissions).where(eq(portalSubmissions.id,key));if(!old)return null;if(old.request!==request)throw new PortalError("CONFLICT",409);return {ok:true,orderId:old.orderId};}
  await requireAccount(user.userId);
  const old=await replay();if(old)return json(old);
  const {id,quote:fingerprint,...input}=d;
  let plan;try{plan=await quote(input,user.userId);}catch(e){const duplicate=await replay();if(duplicate)return json(duplicate);throw e;}if(fingerprint!==plan.preview.quote)throw new PortalError("PORTAL_PREVIEW_CHANGED",409);
  const since=new Date(Date.now()-86400000).toISOString();
  const [pending,recent]=await Promise.all([db.select({count:sql<number>`count(*)`}).from(orders).where(and(eq(orders.portalUserId,user.userId),eq(orders.status,"requested"))),db.select({count:sql<number>`count(*)`}).from(portalSubmissions).where(and(eq(portalSubmissions.userId,user.userId),gte(portalSubmissions.createdAt,since)))]);
  if(pending[0].count>=10||recent[0].count>=20)throw new PortalError("PORTAL_LIMIT",429);
  const orderId=crypto.randomUUID(),itemRows=plan.lines.map(i=>({...i,id:crypto.randomUUID()}));
  try{
    await env.DB!.batch([
      env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM fulfillment_policy WHERE id=1 AND revision=?) AND julianday('now')<julianday(?) THEN ? ELSE NULL END,'fulfillment_order_checked',?,'',?)").bind(crypto.randomUUID(),plan.policyRevision,[cutoffInstant(d.date+'T'+(d.time||'23:59')),plan.orderUntilAt].filter((v):v is string=>!!v).sort()[0]??null,user.userId,orderId,now),
      // Mentett nap: a változat, az aktív állapot és a határidő; nem mentett nap (v54): közben sem mentették, és az alapértelmezett határidő még nem járt le.
      plan.day
        ?env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM menu_days WHERE date=? AND revision=? AND active=1 AND julianday('now')<julianday(cutoff_at)) THEN ? ELSE NULL END,'portal_menu_checked',?,'',?)").bind(crypto.randomUUID(),d.date,plan.day.revision,user.userId,orderId,now)
        :env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN NOT EXISTS (SELECT 1 FROM menu_days WHERE date=?) AND julianday('now')<julianday(?) THEN ? ELSE NULL END,'portal_menu_checked',?,'',?)").bind(crypto.randomUUID(),d.date,plan.autoCutoff,user.userId,orderId,now),
      env.DB!.prepare("INSERT INTO orders (id,customer_id,customer_name,address,phone,date,time,note,production,delivery,payment,status,revision,created_at,portal_user_id,fulfillment_mode,fulfillment_slot_id,fulfillment_postal_code,fulfillment_snapshot,delivery_fee,expected_payment_method) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM portal_profiles WHERE user_id=? AND revision=? AND active=1) AND (SELECT COUNT(*) FROM orders WHERE portal_user_id=? AND status='requested')<10 AND (SELECT COUNT(*) FROM portal_submissions WHERE user_id=? AND created_at>=?)<20 AND NOT EXISTS (SELECT 1 FROM json_each(?) AS i WHERE NOT EXISTS (SELECT 1 FROM products WHERE id=json_extract(i.value,'$.productId') AND active=1 AND portal_revision=json_extract(i.value,'$.portalRevision'))) THEN ? ELSE NULL END,?,?,?,?,?,?,'queued','pending','unpaid','requested',0,?,?,?,?,?,?,?,?)").bind(orderId,user.userId,plan.p.revision,user.userId,user.userId,since,JSON.stringify(plan.lines),plan.p.customerId,plan.p.name,d.mode==="pickup"?[...new Set([plan.preview.fulfillment.addressHu,plan.preview.fulfillment.addressRo])].join(" / "):plan.p.address,plan.p.phone,d.date,d.time||kitchenWallTime().slice(11,16),d.note,now,user.userId,d.mode,null,'',JSON.stringify(plan.preview.fulfillment),plan.preview.fulfillment.fee,d.expectedPaymentMethod),
      // A menüár nem változhatott az előnézet óta (v49).
      ...(plan.setPriceRevision===null?[]:[env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM menu_settings WHERE id=1 AND revision=?) THEN ? ELSE NULL END,'portal_menu_price_checked',?,'',?)").bind(crypto.randomUUID(),plan.setPriceRevision,user.userId,orderId,now)]),
      env.DB!.prepare("INSERT INTO order_items (id,order_id,product_id,hu,ro,allergens,quantity,price,recipe_id,set_group) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.productId'),json_extract(value,'$.hu'),json_extract(value,'$.ro'),json_extract(value,'$.allergens'),json_extract(value,'$.quantity'),json_extract(value,'$.price'),json_extract(value,'$.recipeId'),json_extract(value,'$.setGroup') FROM json_each(?)").bind(orderId,JSON.stringify(itemRows)),
      env.DB!.prepare("INSERT INTO portal_submissions (id,user_id,order_id,request,created_at) VALUES (?,?,?,?,?)").bind(key,user.userId,orderId,request,now),
      audit("portal_order_requested",orderId,plan.p.name),
    ]);
  }catch(e){if(/FULFILLMENT_CAPACITY|MENU_CAPACITY|UNIQUE|NOT NULL|FOREIGN KEY/.test(String(e))){const duplicate=await replay();if(duplicate)return json(duplicate);if(/FULFILLMENT_CAPACITY/.test(String(e)))throw new PortalError("FULFILLMENT_CAPACITY",409);if(/MENU_CAPACITY/.test(String(e)))throw new PortalError("MENU_CAPACITY",409);throw new PortalError("CONFLICT",409);}throw e;}
  return json({ok:true,orderId},201);
}
