"use client";
import CourierAccountBindings from "./courier-account-bindings";
import { TemporaryPasswordButton } from "./auth-page";
import { useState, useEffect } from "react";
import { messages } from "@/src/modules/shared/i18n";
import { staffRoles, type Member, type Session } from "@/src/modules/access/domain";
import type { Language } from "@/src/modules/shared/domain";
export default function AccessWorkspace({lang,session,busy,mutate}:{lang:Language;session:Session;busy:boolean;mutate:(path:string,body:unknown)=>Promise<boolean>}){
  const [members,setMembers]=useState<Member[]>([]),[error,setError]=useState("");
  const t=(k:string)=>messages[lang][k]??k;
  async function load(){
    try{const r=await fetch("/api/access/members",{cache:"no-store"});const d=await r.json() as Member[] & {error?:string};if(!r.ok)throw new Error(d.error||"loadError");setMembers(d);setError("");}catch(e){setError(e instanceof Error?e.message:"loadError");}
  }
  useEffect(()=>{void load();},[]);
  return <section className="panel access-panel"><div className="panel-heading"><div><h2>{t("access")}</h2><p>{t("accessHint")}</p></div><button className="button secondary" disabled={busy} onClick={()=>void load()}>{t("refresh")}</button></div><p className="access-scope">{t("staffScope")}</p>{error&&<p role="alert">{t(error)}</p>}<div className="access-members">{members.map(m=><MemberRow key={m.userId+":"+m.revision} member={m} locked={m.role==="owner"||m.userId===session.userId} lang={lang} busy={busy} save={async role=>{if(await mutate("access/role",{userId:m.userId,revision:m.revision,role}))await load();}}/>)}</div><p className="access-scope">{t("accessProtected")}</p><CourierAccountBindings lang={lang} refreshKey={members.map(m=>m.userId+":"+m.role+":"+m.revision).join("|")}/></section>;
}
function MemberRow({member,locked,lang,busy,save}:{member:Member;locked:boolean;lang:Language;busy:boolean;save:(role:string)=>Promise<void>}){
  const [role,setRole]=useState(member.role);
  const t=(k:string)=>messages[lang][k]??k;
  return <form className="access-member" onSubmit={e=>{e.preventDefault();void save(role);}}><div><strong>{member.name}</strong><small>{member.email}</small><span className="badge">{t("role_"+member.role)}</span></div><label>{t("role")}<select aria-label={t("role")+" · "+member.name} value={role} disabled={locked||busy} onChange={e=>setRole(e.target.value)}>{(member.role==="owner"?["owner"]:staffRoles).map(r=><option key={r} value={r}>{t("role_"+r)}</option>)}</select></label><button className="button secondary" disabled={locked||busy||role===member.role}>{t("save")}</button>{!locked&&<TemporaryPasswordButton userId={member.userId} name={member.name} lang={lang} disabled={busy}/>}</form>;
}
