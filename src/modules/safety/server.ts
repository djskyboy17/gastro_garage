import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { safetyPoints, safetyRecords } from "@/db/schema";
import { today } from "../shared/domain";
import { safetyOutcome, validRecheck, type SafetyData, type SafetyRecord } from "./domain";
export class SafetyError extends Error {constructor(public code:string,public status=400){super(code);}}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
const text=(max=200)=>z.string().trim().min(1).max(max);
const temperature=z.number().int().min(-1000).max(3000).nullable();
const pointFields={hu:text(),ro:text(),area:text(),kind:z.enum(["temperature","checklist"]),min:temperature,max:temperature,instructionsHu:z.string().trim().max(1000),instructionsRo:z.string().trim().max(1000),active:z.number().int().min(0).max(1)};
function record(row:typeof safetyRecords.$inferSelect):SafetyRecord {
  const {request,...rest}=row;
  return {...rest,snapshot:JSON.parse(row.snapshot)};
}
export async function loadSafety():Promise<SafetyData>{
  const db=getDb();
  const [points,records]=await Promise.all([db.select().from(safetyPoints).orderBy(asc(safetyPoints.hu)),db.select().from(safetyRecords).orderBy(desc(safetyRecords.createdAt))]);
  return {points,records:records.map(record)};
}
export async function handleSafety(path:string,body:unknown,actor:string,actorName:string):Promise<Response|null>{
  if(!path.startsWith("/api/safety/"))return null;
  const db=getDb(),now=new Date().toISOString();
  const audit=(action:string,entity:string,detail:string)=>env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),actor,action,entity,detail,now);
  async function batch(commands:D1PreparedStatement[]){
    try{return await env.DB!.batch(commands);}catch(e){if(/NOT NULL|UNIQUE|FOREIGN KEY|CHECK/.test(String(e)))throw new SafetyError("CONFLICT",409);throw e;}
  }
  if(path==="/api/safety/points"){
    const d=z.object({id:z.string().uuid(),revision:z.number().int().min(0).optional(),...pointFields}).parse(body);
    if(d.kind==="temperature"?(d.min===null||d.max===null||d.min>d.max):(d.min!==null||d.max!==null))throw new SafetyError("SAFETY_LIMITS");
    const [old]=await db.select().from(safetyPoints).where(eq(safetyPoints.id,d.id));
    const fields=Object.keys(pointFields) as (keyof typeof pointFields)[];
    if(old && d.revision===undefined){if(fields.every(k=>old[k]===d[k]))return json({ok:true,id:d.id});throw new SafetyError("CONFLICT",409);}
    if(old && old.kind!==d.kind)throw new SafetyError("SAFETY_KIND_LOCKED");
    if(old && d.revision!==old.revision)throw new SafetyError("CONFLICT",409);
    if(!old && d.revision!==undefined)throw new SafetyError("NOT_FOUND",404);
    if(old){
      const result=await batch([
        env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'safety_point_updated',?,?,? WHERE EXISTS (SELECT 1 FROM safety_points WHERE id=? AND revision=?)").bind(crypto.randomUUID(),actor,d.id,JSON.stringify(d),now,d.id,d.revision!),
        env.DB!.prepare("UPDATE safety_points SET hu=?,ro=?,area=?,kind=?,min=?,max=?,instructions_hu=?,instructions_ro=?,active=?,revision=revision+1 WHERE id=? AND revision=?").bind(d.hu,d.ro,d.area,d.kind,d.min,d.max,d.instructionsHu,d.instructionsRo,d.active,d.id,d.revision!),
      ]);
      if(result[1].meta.changes!==1)throw new SafetyError("CONFLICT",409);
      return json({ok:true,id:d.id});
    }
    await batch([env.DB!.prepare("INSERT INTO safety_points (id,hu,ro,area,kind,min,max,instructions_hu,instructions_ro,active,revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)").bind(d.id,d.hu,d.ro,d.area,d.kind,d.min,d.max,d.instructionsHu,d.instructionsRo,d.active,now),audit("safety_point_created",d.id,JSON.stringify(d))]);
    return json({ok:true,id:d.id},201);
  }
  if(path==="/api/safety/records"){
    const d=z.object({id:z.string().uuid(),pointId:z.string().uuid(),pointRevision:z.number().int().min(0),temperature,answer:z.enum(["pass","fail"]).nullable(),note:z.string().trim().max(1000)}).parse(body);
    const request=JSON.stringify(d);
    const [old]=await db.select().from(safetyRecords).where(eq(safetyRecords.id,d.id));
    if(old){if(old.request!==request)throw new SafetyError("CONFLICT",409);return json({ok:true,id:d.id});}
    const [p]=await db.select().from(safetyPoints).where(eq(safetyPoints.id,d.pointId));
    if(!p||!p.active)throw new SafetyError("SAFETY_POINT_INACTIVE");
    if(p.revision!==d.pointRevision)throw new SafetyError("CONFLICT",409);
    const outcome=safetyOutcome(p,d.temperature,d.answer);
    if(outcome==="fail"&&!d.note)throw new SafetyError("SAFETY_NOTE_REQUIRED");
    const {id,active,revision,createdAt,...snapshot}=p;
    await batch([
      env.DB!.prepare("INSERT INTO safety_records (id,point_id,snapshot,temperature,answer,outcome,day,note,actor,actor_name,created_at,request,status,revision,correction,resolved_by,resolved_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM safety_points WHERE id=? AND revision=? AND active=1) THEN ? ELSE NULL END,?,?,?,?,?,?,?,?,?,?,?,0,'','','')").bind(d.id,p.id,p.revision,p.id,JSON.stringify(snapshot),d.temperature,d.answer,outcome,today(),d.note,actor,actorName,now,request,outcome==="fail"?"open":"recorded"),
      audit("safety_recorded",d.id,JSON.stringify({pointId:p.id,outcome})),
    ]);
    return json({ok:true,id:d.id},201);
  }
  if(path==="/api/safety/resolve"){
    const d=z.object({id:z.string().uuid(),revision:z.number().int().min(0),recheckId:z.string().uuid(),correction:text(1500)}).parse(body);
    const [r]=await db.select().from(safetyRecords).where(eq(safetyRecords.id,d.id));
    if(!r)throw new SafetyError("NOT_FOUND",404);
    if(r.status==="resolved"){
      if(r.recheckId===d.recheckId&&r.correction===d.correction)return json({ok:true});
      throw new SafetyError("CONFLICT",409);
    }
    if(r.status!=="open"||r.revision!==d.revision)throw new SafetyError("CONFLICT",409);
    const [check]=await db.select().from(safetyRecords).where(eq(safetyRecords.id,d.recheckId));
    if(!check||!validRecheck(record(r),record(check)))throw new SafetyError("SAFETY_RECHECK_REQUIRED");
    const result=await batch([
      env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'safety_resolved',?,?,? WHERE EXISTS (SELECT 1 FROM safety_records WHERE id=? AND revision=? AND status='open')").bind(crypto.randomUUID(),actor,d.id,JSON.stringify({correction:d.correction,recheckId:d.recheckId}),now,d.id,d.revision),
      env.DB!.prepare("UPDATE safety_records SET status='resolved',correction=?,recheck_id=?,resolved_by=?,resolved_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='open'").bind(d.correction,d.recheckId,actorName,now,d.id,d.revision),
    ]);
    if(result[1].meta.changes!==1)throw new SafetyError("CONFLICT",409);
    return json({ok:true});
  }
  return json({error:"NOT_FOUND"},404);
}
