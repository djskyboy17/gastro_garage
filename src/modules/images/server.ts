import {env} from 'cloudflare:workers';
import {z} from 'zod';
import type {Session} from '../access/domain';
import {ImageError,validateImage,base64ToBytes} from './domain.ts';
export {ImageError};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
/**
 * Ételkép kiszolgálása. Az ügyfélportálon látható, aktív étel képe bárkinek elérhető (hosszú gyorsítótárral,
 * mert az URL verziózott); a többi csak bejelentkezett dolgozónak (`staff` = true).
 */
export async function serveProductImage(req:Request,staff:()=>Promise<boolean>){
 const url=new URL(req.url);const id=url.searchParams.get('id')??'';
 if(!id||id.length>200)return json({error:'NOT_FOUND'},404);
 const row=await env.DB!.prepare("SELECT i.mime,i.data,p.image_revision AS rev,p.active AND p.portal_visible AS public FROM product_images i JOIN products p ON p.id=i.product_id WHERE i.product_id=?").bind(id).first<{mime:string;data:string;rev:number;public:number}>();
 if(!row)return json({error:'NOT_FOUND'},404);
 const isPublic=row.public===1;
 if(!isPublic&&!(await staff()))return json({error:'NOT_FOUND'},404);
 const versioned=url.searchParams.get('v')===String(row.rev);
 return new Response(base64ToBytes(row.data),{headers:{
  'Content-Type':row.mime,
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'",
  'Cache-Control':isPublic&&versioned?'public, max-age=31536000, immutable':'private, max-age=300',
 }});
}
/** Kép feltöltése vagy törlése (admin, diszpécser). Revízióellenőrzés, kép, termék és napló egy tranzakcióban. */
export async function handleProductImage(path:string,body:unknown,session:Session){
 if(!['owner','admin','dispatcher'].includes(session.role))throw new ImageError('FORBIDDEN',403);
 const now=new Date().toISOString();
 const guard="EXISTS (SELECT 1 FROM products WHERE id=? AND image_revision=?)";
 if(path==='/api/products/image'){
  const d=z.object({productId:z.string().min(1).max(200),revision:z.number().int().min(0),data:z.string().min(1).max(900_000)}).strict().parse(body);
  const {mime,bytes}=validateImage(d.data);
  const result=await env.DB!.batch([
   env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'product_image_saved',?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),session.userId,d.productId,JSON.stringify({mime,bytes:bytes.length}),now,d.productId,d.revision),
   env.DB!.prepare(`INSERT INTO product_images (product_id,mime,data,updated_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(product_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,updated_at=excluded.updated_at`).bind(d.productId,mime,d.data,now,d.productId,d.revision),
   env.DB!.prepare("UPDATE products SET has_image=1,image_revision=image_revision+1 WHERE id=? AND image_revision=?").bind(d.productId,d.revision),
  ]);
  if(result[2]!.meta.changes!==1)throw new ImageError('CONFLICT',409);
  return json({ok:true,revision:d.revision+1});
 }
 if(path==='/api/products/image/remove'){
  const d=z.object({productId:z.string().min(1).max(200),revision:z.number().int().min(0)}).strict().parse(body);
  const guard="EXISTS (SELECT 1 FROM products WHERE id=? AND image_revision=? AND has_image=1)";
  const result=await env.DB!.batch([
   env.DB!.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'product_image_removed',?,'',? WHERE ${guard}`).bind(crypto.randomUUID(),session.userId,d.productId,now,d.productId,d.revision),
   env.DB!.prepare(`DELETE FROM product_images WHERE product_id=? AND ${guard}`).bind(d.productId,d.productId,d.revision),
   env.DB!.prepare("UPDATE products SET has_image=0,image_revision=image_revision+1 WHERE id=? AND image_revision=? AND has_image=1").bind(d.productId,d.revision),
  ]);
  if(result[2]!.meta.changes!==1)throw new ImageError('CONFLICT',409);
  return json({ok:true});
 }
 return json({error:'NOT_FOUND'},404);
}
