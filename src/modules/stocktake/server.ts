import {env} from 'cloudflare:workers';
import {eq,desc,inArray} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {stocktakes,stocktakeLines,stockLots,ingredients} from '@/db/schema';
import {nextStocktakeState} from '../shared/domain';
import {countDelta,readyToPost,type Stocktake,type StocktakeData,type CountSnapshot} from './domain';

export class StocktakeError extends Error{constructor(public code:string,public status=400){super(code);}}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const id=z.string().uuid();
const key=z.string().min(1).max(200);
const command=z.object({id,revision:z.number().int().min(0)}).strict();
async function document(id:string):Promise<Stocktake>{
  const db=getDb(),[row]=await db.select().from(stocktakes).where(eq(stocktakes.id,id));
  if(!row)throw new StocktakeError('NOT_FOUND',404);
  const lines=await db.select().from(stocktakeLines).where(eq(stocktakeLines.stocktakeId,id));
  const {request,...header}=row;
  return {...header,lines:lines.map(l=>({...l,snapshot:JSON.parse(l.snapshot) as CountSnapshot}))};
}
export async function loadStocktakes():Promise<StocktakeData>{
  const db=getDb(),headers=await db.select().from(stocktakes).orderBy(desc(stocktakes.createdAt)).limit(100);
  const lines=headers.length?await db.select().from(stocktakeLines).where(inArray(stocktakeLines.stocktakeId,headers.map(h=>h.id))):[];
  return {stocktakes:headers.map(({request,...h})=>({...h,lines:lines.filter(l=>l.stocktakeId===h.id).map(l=>({...l,snapshot:JSON.parse(l.snapshot) as CountSnapshot}))}))};
}
export async function handleStocktake(path:string,body:unknown,actor:string):Promise<Response|null>{
  if(!path.startsWith('/api/stocktake/'))return null;
  const db=getDb(),now=new Date().toISOString();
  const audit=(action:string,entity:string,detail:string)=>env.DB!.prepare('INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,entity,detail,now);
  const guard=(id:string,revision:number,status:string,extra='1=1')=>env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM stocktakes WHERE id=? AND revision=? AND status=?) AND (${extra}) THEN ? ELSE NULL END,'stocktake_checked',?,'',?)`).bind(crypto.randomUUID(),id,revision,status,actor,id,now);
  try{
    if(path==='/api/stocktake/create'){
      const d=z.object({id,title:z.string().trim().min(1).max(200),lotIds:z.array(key).min(1).max(300)}).strict().parse(body);
      if(new Set(d.lotIds).size!==d.lotIds.length)throw new StocktakeError('VALIDATION');
      d.lotIds.sort();const request=JSON.stringify(d);
      const replay=async()=>{const [old]=await db.select().from(stocktakes).where(eq(stocktakes.id,d.id));if(!old)return false;if(old.request!==request)throw new StocktakeError('CONFLICT',409);return true;};
      if(await replay())return json({ok:true,id:d.id});
      const [lots,items]=await Promise.all([db.select().from(stockLots).where(inArray(stockLots.id,d.lotIds)),db.select().from(ingredients)]);
      if(lots.length!==d.lotIds.length)throw new StocktakeError('INVALID_ITEM');
      const lines=lots.map(l=>{const i=items.find(i=>i.id===l.ingredientId)!;return {id:crypto.randomUUID(),lotId:l.id,expected:l.remaining,lotRevision:l.revision,snapshot:JSON.stringify({hu:i.hu,ro:i.ro,unit:i.unit,batch:l.batch,expires:l.expires,supplier:l.supplier,document:l.document,quantity:l.quantity,totalCost:l.totalCost})};});
      try{await env.DB!.batch([
        env.DB!.prepare("INSERT INTO stocktakes (id,title,status,revision,request,created_by,created_at) VALUES (?,?,'draft',0,?,?,?)").bind(d.id,d.title,request,actor,now),
        env.DB!.prepare("INSERT INTO stocktake_lines (id,stocktake_id,lot_id,snapshot,expected,lot_revision,counted,note) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.lotId'),json_extract(value,'$.snapshot'),json_extract(value,'$.expected'),json_extract(value,'$.lotRevision'),NULL,'' FROM json_each(?)").bind(d.id,JSON.stringify(lines)),
        audit('stocktake_created',d.id,d.title),
      ]);}catch(e){if(/UNIQUE/.test(String(e))&&await replay())return json({ok:true,id:d.id});throw e;}
      return json({ok:true,id:d.id},201);
    }
    const base=command.passthrough().parse(body),doc=await document(base.id);
    if(path==='/api/stocktake/save'){
      const d=command.extend({lines:z.array(z.object({lotId:key,counted:z.number().int().min(0).max(10000000).nullable(),note:z.string().trim().max(1000)}).strict()).min(1).max(300)}).strict().parse(body);
      if(doc.status!=='draft')throw new StocktakeError('STOCKTAKE_STATE');
      if(doc.revision!==d.revision)throw new StocktakeError('CONFLICT',409);
      if(new Set(d.lines.map(l=>l.lotId)).size!==doc.lines.length||d.lines.length!==doc.lines.length||d.lines.some(l=>!doc.lines.some(s=>s.lotId===l.lotId)))throw new StocktakeError('VALIDATION');
      await env.DB!.batch([guard(d.id,d.revision,'draft'),...d.lines.map(l=>env.DB!.prepare('UPDATE stocktake_lines SET counted=?,note=? WHERE stocktake_id=? AND lot_id=?').bind(l.counted,l.note,d.id,l.lotId)),env.DB!.prepare('UPDATE stocktakes SET revision=revision+1 WHERE id=?').bind(d.id),audit('stocktake_saved',d.id,doc.title)]);
      return json({ok:true});
    }
    if(path==='/api/stocktake/refresh-line'){
      const d=command.extend({lotId:key}).strict().parse(body);
      if(doc.status!=='draft')throw new StocktakeError('STOCKTAKE_STATE');
      if(doc.revision!==d.revision)throw new StocktakeError('CONFLICT',409);
      if(!doc.lines.some(l=>l.lotId===d.lotId))throw new StocktakeError('INVALID_ITEM');
      await env.DB!.batch([guard(d.id,d.revision,'draft'),env.DB!.prepare("UPDATE stocktake_lines SET expected=(SELECT remaining FROM stock_lots WHERE id=?),lot_revision=(SELECT revision FROM stock_lots WHERE id=?),counted=NULL,note='' WHERE stocktake_id=? AND lot_id=?").bind(d.lotId,d.lotId,d.id,d.lotId),env.DB!.prepare('UPDATE stocktakes SET revision=revision+1 WHERE id=?').bind(d.id),audit('stocktake_refreshed',d.id,doc.title)]);
      return json({ok:true});
    }
    if(path==='/api/stocktake/post'){
      const d=command.parse(body);
      if(doc.status==='posted'&&doc.revision===d.revision+1)return json({ok:true});
      nextStocktakeState(doc.status,'post');
      if(doc.revision!==d.revision)throw new StocktakeError('CONFLICT',409);
      readyToPost(doc.lines);
      const changed=doc.lines.filter(l=>countDelta(l.expected,l.counted!)!==0);
      const extra=`NOT EXISTS (SELECT 1 FROM stocktake_lines l JOIN stock_lots s ON s.id=l.lot_id WHERE l.stocktake_id='${d.id}' AND (s.revision<>l.lot_revision OR s.remaining<>l.expected))`;
      const lots=await db.select().from(stockLots).where(inArray(stockLots.id,doc.lines.map(l=>l.lotId)));
      if(doc.lines.some(l=>!lots.some(s=>s.id===l.lotId&&s.revision===l.lotRevision&&s.remaining===l.expected)))throw new StocktakeError('STOCKTAKE_STALE',409);
      await env.DB!.batch([
        guard(d.id,d.revision,'draft',extra),
        ...changed.flatMap(l=>{const delta=countDelta(l.expected,l.counted!);return [env.DB!.prepare('UPDATE stock_lots SET remaining=remaining+?,adjustment_total=adjustment_total+? WHERE id=?').bind(delta,delta,l.lotId),env.DB!.prepare("INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,'count_adjustment',?,?)").bind('count:'+d.id+':'+l.lotId,l.lotId,delta,doc.title+' · '+l.note,now)];}),
        env.DB!.prepare("UPDATE stocktakes SET status='posted',revision=revision+1,posted_by=?,posted_at=? WHERE id=?").bind(actor,now,d.id),audit('stocktake_posted',d.id,doc.title),
      ]);
      return json({ok:true});
    }
    if(path==='/api/stocktake/cancel'||path==='/api/stocktake/reverse'){
      const d=command.extend({note:z.string().trim().min(1).max(1000)}).strict().parse(body),reverse=path.endsWith('/reverse'),action=reverse?'reverse':'cancel',target=reverse?'reversed':'cancelled';
      if(doc.status===target&&doc.revision===d.revision+1&&doc.closeNote===d.note)return json({ok:true});
      nextStocktakeState(doc.status,action);
      if(doc.revision!==d.revision)throw new StocktakeError('CONFLICT',409);
      const changed=reverse?doc.lines.filter(l=>countDelta(l.expected,l.counted!)!==0):[];
      const lots=changed.length?await db.select().from(stockLots).where(inArray(stockLots.id,changed.map(l=>l.lotId))):[];
      if(changed.some(l=>!lots.some(s=>s.id===l.lotId&&s.revision===l.lotRevision+1&&s.remaining===l.counted)))throw new StocktakeError('STOCKTAKE_REVERSE_CHANGED',409);
      const extra=reverse?`NOT EXISTS (SELECT 1 FROM stocktake_lines l JOIN stock_lots s ON s.id=l.lot_id WHERE l.stocktake_id='${d.id}' AND l.counted<>l.expected AND (s.revision<>l.lot_revision+1 OR s.remaining<>l.counted))`:'1=1';
      await env.DB!.batch([
        guard(d.id,d.revision,reverse?'posted':'draft',extra),
        ...changed.flatMap(l=>{const delta=-countDelta(l.expected,l.counted!);return [env.DB!.prepare('UPDATE stock_lots SET remaining=remaining+?,adjustment_total=adjustment_total+? WHERE id=?').bind(delta,delta,l.lotId),env.DB!.prepare("INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,'count_reversal',?,?)").bind('count-reversal:'+d.id+':'+l.lotId,l.lotId,delta,doc.title+' · '+d.note,now)];}),
        env.DB!.prepare('UPDATE stocktakes SET status=?,revision=revision+1,closed_by=?,closed_at=?,close_note=? WHERE id=?').bind(target,actor,now,d.note,d.id),audit(reverse?'stocktake_reversed':'stocktake_cancelled',d.id,doc.title+' · '+d.note),
      ]);
      return json({ok:true});
    }
    return json({error:'NOT_FOUND'},404);
  }catch(e){
    if(e instanceof StocktakeError||e instanceof z.ZodError)throw e;
    if(['STOCKTAKE_STATE','STOCKTAKE_QUANTITY','STOCKTAKE_INCOMPLETE','STOCKTAKE_NOTE'].includes(String((e as Error)?.message)))throw new StocktakeError((e as Error).message);
    if(/NOT NULL|UNIQUE|CHECK/.test(String(e)))throw new StocktakeError('STOCKTAKE_CONFLICT',409);
    throw e;
  }
}
