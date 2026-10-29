import { env } from "cloudflare:workers";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { members, workspaceOwners } from "@/db/schema";
import { staffRoles, isAdmin, type Role, type Session } from "./domain";
export class AccessError extends Error {
  constructor(public code:string,public status=403){super(code);}
}
export type Identity = {userId:string;email:string;name:string};
export async function sessionFor(user:Identity): Promise<Session> {
  const db=getDb();
  const [[member],[owner]]=await Promise.all([db.select().from(members).where(eq(members.userId,user.userId)),db.select().from(workspaceOwners).where(eq(workspaceOwners.id,1))]);
  const bootstrapEmail=env.KITCHEN_OWNER_EMAIL?.trim().toLowerCase();
  return {userId:user.userId,name:user.name,role:owner?.userId===user.userId?"owner":(member?.role??"pending") as Role,canBootstrap:!owner && Boolean(bootstrapEmail) && user.email.toLowerCase()===bootstrapEmail};
}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function handleAccess(path:string,body:unknown,user:Identity,session:Session):Promise<Response|null> {
  if (path==="/api/access/request") {
    const now=new Date().toISOString();
    const cmds: D1PreparedStatement[]=[];
    if(session.canBootstrap) cmds.push(env.DB!.prepare("INSERT INTO workspace_owners (id,user_id) VALUES (1,?) ON CONFLICT(id) DO NOTHING").bind(user.userId));
    cmds.push(env.DB!.prepare("INSERT INTO members (user_id,name,email,role,revision,created_at) VALUES (?,?,?,'pending',0,?) ON CONFLICT(user_id) DO NOTHING").bind(user.userId,user.name.slice(0,200),user.email.slice(0,254),now));
    cmds.push(env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'access_requested',?,'',? WHERE changes()=1").bind(crypto.randomUUID(),user.userId,user.userId,now));
    await env.DB!.batch(cmds);
    return json(await sessionFor(user));
  }
  if(path!=="/api/access/role") return null;
  if(!isAdmin(session.role)) throw new AccessError("FORBIDDEN");
  const d=z.object({userId:z.string().min(1).max(200),revision:z.number().int().min(0),role:z.enum(staffRoles)}).parse(body);
  if(d.userId===user.userId) throw new AccessError("SELF_ROLE_LOCKED",400);
  const [owner]=await getDb().select().from(workspaceOwners).where(eq(workspaceOwners.id,1));
  if(d.userId===owner?.userId) throw new AccessError("OWNER_ROLE_LOCKED",400);
  const [old]=await getDb().select().from(members).where(eq(members.userId,d.userId));
  if(!old) throw new AccessError("NOT_FOUND",404);
  if(old.revision!==d.revision) throw new AccessError("CONFLICT",409);
  const result=await env.DB!.batch([
    env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) SELECT ?,?,'role_changed',?,?,? WHERE EXISTS (SELECT 1 FROM members WHERE user_id=? AND revision=?)").bind(crypto.randomUUID(),user.userId,d.userId,JSON.stringify({from:old.role,to:d.role}),new Date().toISOString(),d.userId,d.revision),
    env.DB!.prepare("UPDATE members SET role=?,revision=revision+1 WHERE user_id=? AND revision=? AND user_id NOT IN (SELECT user_id FROM workspace_owners)").bind(d.role,d.userId,d.revision),
  ]);
  // D1 counts trigger-driven courier unlink updates as well as the member update.
  if(result[1].meta.changes<1) throw new AccessError("CONFLICT",409);
  return json({ok:true});
}
export async function loadMembers(session:Session){
  if(!isAdmin(session.role)) throw new AccessError("FORBIDDEN");
  const rows=await getDb().select().from(members).orderBy(asc(members.createdAt));
  const [owner]=await getDb().select().from(workspaceOwners).where(eq(workspaceOwners.id,1));
  return rows.map(m=>({...m,role:m.userId===owner?.userId?"owner":m.role}));
}
