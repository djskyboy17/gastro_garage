import {env} from 'cloudflare:workers';
import {getDb} from '@/db';
import {menuDays,menuSettings,products} from '@/db/schema';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {today} from '../shared/domain';
import {publicProduct} from '../portal/domain';
import {publicDishInfos} from '../inventory/server';
import {validDay,addDays,cutoffInstant,menuSetError,remaining,UNLIMITED,type MenuData,type MenuSettings} from './domain';
export class MenuError extends Error{constructor(public code:string,public status=400){super(code);}}
const usage=`SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.date=l.date AND i.product_id=l.product_id AND o.status IN ('requested','confirmed')`;
/** A napi menü ára, az alapértelmezett határidő és a változat (v49, v54). Ha a sor hiányzik: 0 ár, 09:00. */
export async function loadMenuSettings():Promise<MenuSettings>{
  const [row]=await getDb().select().from(menuSettings).where(eq(menuSettings.id,1));
  return {setPrice:row?.setPrice??0,defaultCutoff:row?.defaultCutoff??'09:00',revision:row?.revision??0};
}
export async function loadMenu():Promise<MenuData>{
  const [days,lines,settings]=await Promise.all([getDb().select().from(menuDays),env.DB!.prepare(`SELECT l.date,l.product_id AS productId,l.capacity,(${usage}) AS reserved FROM menu_lines l`).all(),loadMenuSettings()]);
  return {days,lines:lines.results as MenuData['lines'],settings};
}
/**
 * A nap nyilvános kínálata. Mentett nap: a mentett étlap (és ha van, a napi menü). Nem mentett nap (v54): magától
 * nyitva az Étlap összes aktív ételével, korlátlan adagszámmal, az alapértelmezett határidőig; napi menü nincs.
 * `auto` jelzi a nem mentett napot; ilyenkor `cutoffAt` az alapértelmezett határidő.
 */
export async function publicMenu(date:string){
  if(!validDay(date)||date<today()||date>addDays(today(),30))throw new MenuError('MENU_DATE');
  const [days,catalog,lines,settings]=await Promise.all([getDb().select().from(menuDays).where(eq(menuDays.date,date)),getDb().select().from(products),env.DB!.prepare(`SELECT l.product_id AS productId,l.capacity,(${usage}) AS reserved FROM menu_lines l WHERE l.date=?`).bind(date).all(),loadMenuSettings()]);
  const day=days[0];
  if(!day){
    const cutoffAt=cutoffInstant(date+'T'+settings.defaultCutoff);
    const offered=catalog.filter(p=>p.active===1&&(p.section??'alacarte')==='alacarte');
    const infos=await publicDishInfos(offered);
    return {date,auto:true,open:!!cutoffAt&&Date.now()<Date.parse(cutoffAt),cutoffAt,items:offered.map(p=>({...publicProduct(p),info:infos.get(p.id)??null,remaining:UNLIMITED})),set:null};
  }
  if(!day.active)return {date,auto:false,open:false,cutoffAt:null,items:[],set:null};
  const offered=catalog.filter(p=>p.active===1&&lines.results.some(l=>l.productId===p.id));
  const infos=await publicDishInfos(offered);
  const items=lines.results.flatMap(l=>{const p=offered.find(p=>p.id===l.productId);return p?[{...publicProduct(p),info:infos.get(p.id)??null,remaining:remaining(Number(l.capacity),Number(l.reserved))}]:[];});
  // Napi menü (v49, v54): csak ha a leves és a főétel be van állítva és rendelhető, és van menüár.
  const parts=[day.setSoupId,day.setMainId].map(id=>items.find(i=>i.id===id));
  const set=settings.setPrice>0&&parts.every(Boolean)?{price:settings.setPrice,priceRevision:settings.revision,soup:parts[0]!,main:parts[1]!,remaining:Math.min(...parts.map(p=>p!.remaining))}:null;
  return {date,auto:false,open:Date.now()<Date.parse(day.cutoffAt),cutoffAt:day.cutoffAt,items,set};
}
const setInput=z.object({soupId:z.string().min(1).max(200),mainId:z.string().min(1).max(200)}).strict();
const input=z.object({date:z.string().refine(validDay),revision:z.number().int().min(0).nullable(),cutoff:z.string(),active:z.number().int().min(0).max(1),items:z.array(z.object({productId:z.string().min(1).max(200),capacity:z.number().int().min(0).max(UNLIMITED)}).strict()).min(1).max(100),set:setInput.nullable().default(null)}).strict();
export async function saveMenu(body:unknown,actor:string){
  const d=input.parse(body),cutoffAt=cutoffInstant(d.cutoff);
  if(d.date<today()||d.date>addDays(today(),90)||!cutoffAt||d.cutoff.slice(0,10)>d.date)throw new MenuError('MENU_DATE');
  if(new Set(d.items.map(i=>i.productId)).size!==d.items.length)throw new MenuError('VALIDATION');
  const db=getDb(),[current]=await db.select().from(menuDays).where(eq(menuDays.date,d.date));
  if((current?.revision??null)!==d.revision)throw new MenuError('CONFLICT',409);
  const catalog=await db.select().from(products);
  if(d.items.some(i=>!catalog.some(p=>p.id===i.productId&&p.active)))throw new MenuError('MENU_PRODUCT');
  if(d.set){const err=menuSetError(d.set,catalog,d.items.map(i=>i.productId));if(err)throw new MenuError(err);}
  const set=[d.set?.soupId??null,d.set?.mainId??null];
  const now=new Date().toISOString();
  try{
    await env.DB!.batch([
      env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN ${current?'EXISTS (SELECT 1 FROM menu_days WHERE date=? AND revision=?)':'NOT EXISTS (SELECT 1 FROM menu_days WHERE date=?)'} THEN ? ELSE NULL END,'menu_updated',?,?,?)`).bind(crypto.randomUUID(),d.date,...(current?[d.revision]:[]),actor,d.date,JSON.stringify(d),now),
      ...(current?[env.DB!.prepare('UPDATE menu_days SET cutoff_at=?,active=?,set_soup_id=?,set_main_id=?,set_dessert_id=NULL,revision=revision+1 WHERE date=? AND revision=?').bind(cutoffAt,d.active,...set,d.date,d.revision)]:[env.DB!.prepare('INSERT INTO menu_days (date,cutoff_at,active,revision,set_soup_id,set_main_id,set_dessert_id) VALUES (?,?,?,0,?,?,NULL)').bind(d.date,cutoffAt,d.active,...set)]),
      // Capacity checks run inside the same transaction as replacement, after other writers.
      env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.date=? AND o.status IN ('requested','confirmed') AND i.product_id IN (SELECT product_id FROM menu_lines WHERE date=?) AND i.product_id NOT IN (SELECT json_extract(value,'$.productId') FROM json_each(?))) THEN ? ELSE NULL END,'menu_capacity_checked',?,'',?)`).bind(crypto.randomUUID(),d.date,d.date,JSON.stringify(d.items),actor,d.date,now),
      env.DB!.prepare('DELETE FROM menu_lines WHERE date=?').bind(d.date),
      env.DB!.prepare("INSERT INTO menu_lines (date,product_id,capacity) SELECT ?,json_extract(value,'$.productId'),json_extract(value,'$.capacity') FROM json_each(?)").bind(d.date,JSON.stringify(d.items)),
    ]);
  }catch(e){if(/MENU_CAPACITY/.test(String(e)))throw new MenuError('MENU_CAPACITY',409);if(/NOT NULL|UNIQUE/.test(String(e)))throw new MenuError('MENU_CONFLICT',409);throw e;}
  return {ok:true};
}
/** A napi menü árának és az alapértelmezett határidőnek a mentése (v49, v54), változat-ellenőrzéssel és naplóval. */
export async function saveMenuSettings(body:unknown,actor:string){
  const d=z.object({revision:z.number().int().min(0),setPrice:z.number().int().min(0).max(10000000),defaultCutoff:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00')}).strict().parse(body);
  const now=new Date().toISOString();
  const result=await env.DB!.batch([
    env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'menu_price_updated','menu_settings',?,? WHERE EXISTS (SELECT 1 FROM menu_settings WHERE id=1 AND revision=?)").bind(crypto.randomUUID(),actor,JSON.stringify({setPrice:d.setPrice,defaultCutoff:d.defaultCutoff}),now,d.revision),
    env.DB!.prepare('UPDATE menu_settings SET set_price=?,default_cutoff=?,revision=revision+1 WHERE id=1 AND revision=?').bind(d.setPrice,d.defaultCutoff,d.revision),
  ]);
  if(result[1]!.meta.changes!==1)throw new MenuError('CONFLICT',409);
  return {ok:true};
}
