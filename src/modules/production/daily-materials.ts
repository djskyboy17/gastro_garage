import { env } from "cloudflare:workers";
import { DEFAULT_SHELF_LIFE_DAYS } from "../labels/domain";
import { allocate } from "../inventory/domain";
import { loadOperations } from "../inventory/server";
import { allocateDocumentNumber } from "../documents/server";
import { addDays } from "../labels/domain";
import { bcLines, reversalBc, type BcContent, type ProductionBatch } from "./domain";
import type { HandoverContent } from "./finished";
import { ProductionError, dayOrders } from "./server";
import { today } from "../shared/domain";

type Material = { batchId: string; day: string; content: string; consumptionId: string | null; revision: number };
type Snapshot = Omit<BcContent, "lines" | "totalValue"> & { needs: { ingredientId: string; planned: number; quantity: number }[]; useBy: string | null };
import { dayTokenSql, dayTokenBinds } from "./daily-material-domain";
export { dayTokenSql, dayTokenBinds } from "./daily-material-domain";
export async function dayToken(day: string) { return (await env.DB!.prepare(dayTokenSql).bind(...dayTokenBinds(day)).first<{token:string}>())!.token; }
export async function saveReadyBatch(batch: ProductionBatch, actual: number, issuedBefore: number, recipeVersion: number, planned: Map<string,number>, lines: {ingredientId:string;quantity:number}[], note: string, actor: string, now: string) {
 const DB=env.DB!;
 const [product,shelf]=await Promise.all([
  DB.prepare("SELECT hu,ro FROM products WHERE id=?").bind(batch.productId).first<{hu:string;ro:string}>(),
  DB.prepare("SELECT shelf_life_days AS days FROM product_labels WHERE product_id=?").bind(batch.productId).first<{days:number}>(),
 ]);
 const useBy=addDays(batch.day,shelf?.days??DEFAULT_SHELF_LIFE_DAYS);
 const content:Snapshot={batch:{id:batch.id,code:batch.code,day:batch.day}, product:product!,portions:{actual,issuedBefore,consumed:Math.max(0,actual-issuedBefore)},recipe:{id:batch.recipeId!,version:recipeVersion},note,useBy,needs:lines.map(l=>({...l,planned:planned.get(l.ingredientId)??0}))};
 await DB.batch([
  DB.prepare("INSERT INTO audit(id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM production_batches WHERE id=? AND revision=? AND status='open') AND NOT EXISTS(SELECT 1 FROM production_day_closes WHERE day=? AND status='closed') THEN ? ELSE NULL END,'production_portions_saved',?,?,?)").bind(crypto.randomUUID(),batch.id,batch.revision,batch.day,actor,batch.id,JSON.stringify({actual,materialPosting:'daily'}),now),
  DB.prepare("INSERT INTO production_materials(batch_id,day,content) VALUES(?,?,?)").bind(batch.id,batch.day,JSON.stringify(content)),
  DB.prepare("UPDATE production_batches SET status='closed',actual=?,issued_before=?,use_by=?,note=?,closed_by=?,closed_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='open'").bind(actual,issuedBefore,useBy,note,actor,now,batch.id,batch.revision),
 ]);
}

/** Builds one combined BC and every stock/BP change; the caller commits these with the day close. */
export async function dailyMaterialStatements(day: string, actor: string, now: string, handover: boolean, signerName = "") {
 const DB=env.DB!;
 const rows=(await DB.prepare("SELECT batch_id AS batchId,day,content,consumption_id AS consumptionId,revision FROM production_materials WHERE day=? AND consumption_id IS NULL ORDER BY batch_id").bind(day).all<Material>()).results;
 const statements:D1PreparedStatement[]=[];
 const values=new Map<string,{totalValue:number;consumed:number}>();
 if(!rows.length)return {statements,values,consumptionId:null as string|null};
 const demand=await dayOrders(day);
 const ops=await loadOperations(),pool=ops.lots.map(l=>({...l}));
 const combined=new Map<string,BcContent['lines'][number]>();
 const details:NonNullable<BcContent['dailyBatches']>=[];
 const consumptionId=crypto.randomUUID();
 const allocations:{batchId:string;code:string;lotId:string;quantity:number}[]=[];
 for(const row of rows){
  const s=JSON.parse(row.content) as Snapshot;
  const batch=await DB.prepare("SELECT product_id AS productId FROM production_batches WHERE id=?").bind(row.batchId).first<{productId:string}>();
  if(Math.min(s.portions.actual,demand.get(batch!.productId)?.issued??0)!==s.portions.issuedBefore)throw new ProductionError("MATERIALS_LEGACY_CHANGED",409);
  const used=new Map(s.needs.filter(n=>n.quantity>0).map(n=>[n.ingredientId,n.quantity]));
  const allocation=allocate(used,pool,day);
  if(allocation.shortage.length)throw new ProductionError('INSUFFICIENT_STOCK');
  const lines=bcLines(new Map(s.needs.map(n=>[n.ingredientId,n.planned])),new Map(s.needs.map(n=>[n.ingredientId,n.quantity])),allocation.allocations,pool,ops.ingredients);
  const value=lines.reduce((sum,l)=>sum+l.value,0);values.set(row.batchId,{totalValue:value,consumed:s.portions.consumed});
  details.push({batchId:row.batchId,code:s.batch.code,product:s.product,actual:s.portions.actual,totalValue:value,consumed:s.portions.consumed});
  for(const line of lines){const old=combined.get(line.ingredientId);if(old){old.planned+=line.planned;old.quantity+=line.quantity;old.value+=line.value;old.lots.push(...line.lots);}else combined.set(line.ingredientId,{...line,lots:[...line.lots]});}
  for(const a of allocation.allocations){pool.find(l=>l.id===a.lotId)!.remaining-=a.quantity;allocations.push({batchId:row.batchId,code:s.batch.code,lotId:a.lotId,quantity:a.quantity});}
  if(handover && s.portions.actual>0){
   const bp=allocateDocumentNumber('handover',day,now);
   const content:HandoverContent={batch:s.batch,product:s.product,portions:s.portions.actual,useBy:s.useBy,value};
   statements.push(...bp.statements,DB.prepare(`INSERT INTO production_documents(id,doc_type,year,number,kind,status,issue_date,day,batch_id,content,created_by,created_at) VALUES(?,'handover',?,${bp.numberSql},'issue','issued',?,?,?,?,?,?)`).bind(crypto.randomUUID(),bp.year,...bp.numberBinds,day,day,row.batchId,JSON.stringify(content),actor,now));
  }
 }
 const first=JSON.parse(rows[0].content) as Snapshot;
 const content:BcContent={batch:{id:rows[0].batchId,code:'ZI-'+day,day},product:{hu:'Napi anyagfelhasználás',ro:'Consum zilnic – toate preparatele'},portions:{actual:details.reduce((s,b)=>s+b.actual,0),issuedBefore:rows.reduce((sum,r)=>sum+(JSON.parse(r.content) as Snapshot).portions.issuedBefore,0),consumed:details.reduce((s,b)=>s+b.consumed,0)},recipe:first.recipe,note:'Centralizator zilnic. Rețetele și cantitățile sunt fixate la înregistrarea producției.',...(signerName?{signer:{name:signerName,at:now}}:{}),lines:[...combined.values()],totalValue:details.reduce((s,b)=>s+b.totalValue,0),dailyBatches:details};
 if(new TextEncoder().encode(JSON.stringify(content)).length>90000)throw new ProductionError('DAILY_MATERIALS_TOO_LARGE');
 const bc=allocateDocumentNumber('consumption',day,now);
 statements.unshift(...bc.statements,DB.prepare(`INSERT INTO consumption_documents(id,batch_id,year,number,kind,status,issue_date,content,created_by,created_at) VALUES(?,?,?,${bc.numberSql},'consumption','issued',?,?,?,?)`).bind(consumptionId,rows[0].batchId,bc.year,...bc.numberBinds,day,JSON.stringify(content),actor,now));
 for(const lotId of new Set(allocations.map(a=>a.lotId))){const lot=ops.lots.find(l=>l.id===lotId)!;statements.unshift(DB.prepare("INSERT INTO audit(id,actor,action,entity,detail,created_at) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM stock_lots WHERE id=? AND remaining=?) THEN ? ELSE NULL END,'daily_stock_checked',?,'',?)").bind(crypto.randomUUID(),lotId,lot.remaining,actor,lotId,now));}
 for(const a of allocations)statements.push(DB.prepare('UPDATE stock_lots SET remaining=remaining-? WHERE id=?').bind(a.quantity,a.lotId),DB.prepare("INSERT INTO stock_moves(id,lot_id,batch_id,quantity,kind,note,created_at) VALUES(?,?,?,?,'production',?,?)").bind(crypto.randomUUID(),a.lotId,a.batchId,-a.quantity,a.code,now));
 for(const row of rows)statements.push(DB.prepare('UPDATE production_materials SET consumption_id=?,revision=revision+1 WHERE batch_id=? AND revision=? AND consumption_id IS NULL').bind(consumptionId,row.batchId,row.revision),DB.prepare('UPDATE production_batches SET consumption_id=?,revision=revision+1 WHERE id=? AND status=\'closed\'').bind(consumptionId,row.batchId));
 if(statements.length>850)throw new ProductionError('DAILY_MATERIALS_TOO_LARGE');
 return {statements,values,consumptionId};
}

/** Reopening preserves the ready portions but reverses only the new daily posting, never legacy batch BCs. */
export async function reverseDailyMaterials(day:string,reason:string,actor:string,now:string,signerName=''){
 const DB=env.DB!,statements:D1PreparedStatement[]=[];
 const docs=(await DB.prepare("SELECT DISTINCT c.id,c.batch_id AS batchId,c.content FROM production_materials m JOIN consumption_documents c ON c.id=m.consumption_id WHERE m.day=? AND c.status='issued'").bind(day).all<{id:string;batchId:string;content:string}>()).results;
 for(const doc of docs){
  const original=JSON.parse(doc.content) as BcContent,content={...reversalBc(original,reason),...(signerName?{signer:{name:signerName,at:now}}:{})},issueDate=today(),bc=allocateDocumentNumber('consumption',issueDate,now),id=crypto.randomUUID();
  statements.push(...bc.statements,DB.prepare(`INSERT INTO consumption_documents(id,batch_id,year,number,kind,status,reversal_of,issue_date,content,created_by,created_at) VALUES(?,?,?,${bc.numberSql},'reversal','issued',?,?,?,?,?)`).bind(id,doc.batchId,bc.year,...bc.numberBinds,doc.id,issueDate,JSON.stringify(content),actor,now),DB.prepare("UPDATE consumption_documents SET status='reversed',reversed_by=? WHERE id=? AND status='issued'").bind(id,doc.id));
  const moves=(await DB.prepare("SELECT s.lot_id AS lotId,s.batch_id AS batchId,s.quantity FROM stock_moves s JOIN production_materials m ON m.batch_id=s.batch_id WHERE m.consumption_id=? AND s.kind IN ('production','production_reversal')").bind(doc.id).all<{lotId:string;batchId:string;quantity:number}>()).results;
  const net=new Map<string,{lotId:string;batchId:string;quantity:number}>();for(const move of moves){const key=move.batchId+'|'+move.lotId;const old=net.get(key);if(old)old.quantity+=move.quantity;else net.set(key,{...move});}
  for(const m of net.values())if(m.quantity)statements.push(DB.prepare('UPDATE stock_lots SET remaining=remaining-? WHERE id=?').bind(m.quantity,m.lotId),DB.prepare("INSERT INTO stock_moves(id,lot_id,batch_id,quantity,kind,note,created_at) VALUES(?,?,?,?,'production_reversal',?,?)").bind(crypto.randomUUID(),m.lotId,m.batchId,-m.quantity,reason,now));
  const handovers=(await DB.prepare("SELECT d.id,d.batch_id AS batchId,d.content FROM production_documents d JOIN production_materials m ON m.batch_id=d.batch_id WHERE m.consumption_id=? AND d.doc_type='handover' AND d.kind='issue' AND d.status='issued'").bind(doc.id).all<{id:string;batchId:string;content:string}>()).results;
  for(const h of handovers){const bp=allocateDocumentNumber('handover',issueDate,now),hid=crypto.randomUUID(),c=JSON.parse(h.content) as HandoverContent;c.value=-c.value;c.portions=-c.portions;statements.push(...bp.statements,DB.prepare(`INSERT INTO production_documents(id,doc_type,year,number,kind,status,reversal_of,issue_date,day,batch_id,content,created_by,created_at) VALUES(?,'handover',?,${bp.numberSql},'reversal','issued',?,?,?,?,?,?,?)`).bind(hid,bp.year,...bp.numberBinds,h.id,issueDate,day,h.batchId,JSON.stringify({...c,reason}),actor,now),DB.prepare("UPDATE production_documents SET status='reversed',reversed_by=? WHERE id=?").bind(hid,h.id));}
  statements.push(DB.prepare('UPDATE production_batches SET consumption_id=NULL,revision=revision+1 WHERE id IN (SELECT batch_id FROM production_materials WHERE consumption_id=?)').bind(doc.id),DB.prepare('UPDATE production_materials SET consumption_id=NULL,revision=revision+1 WHERE consumption_id=?').bind(doc.id));
 }
 return statements;
}
