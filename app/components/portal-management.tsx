"use client";
import {useEffect,useState} from "react";
import {ExternalLink,Check,RefreshCw} from "lucide-react";
import {messages} from "@/src/modules/shared/i18n";
import {isAdmin,type Role} from "@/src/modules/access/domain";
import {total,orderCode,type AppData,type Language,type Order} from "@/src/modules/shared/domain";
import type {PortalAccount} from "@/src/modules/portal/domain";
import {TemporaryPasswordButton} from "./auth-page";
type Props={data:AppData;lang:Language;role:Role;busy:boolean;mutate:(path:string,body:unknown)=>Promise<boolean>;refresh:()=>Promise<void>;onOrder:(o:Order)=>void};
export default function PortalManagement({data,lang,role,busy,mutate,refresh,onOrder}:Props){
  const t=(k:string)=>messages[lang][k]??k,[accounts,setAccounts]=useState<PortalAccount[]>([]),[error,setError]=useState("");
  const requests=data.orders.filter(o=>o.portalUserId&&o.status==="requested").sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const money=(n:number)=>new Intl.NumberFormat(lang==="hu"?"hu-HU":"ro-RO",{style:"currency",currency:"RON"}).format(n/100);
  async function load(){try{const r=await fetch("/api/portal/accounts",{cache:"no-store"});const d=await r.json() as PortalAccount[]&{error?:string};if(!r.ok)throw new Error(d.error??"loadError");setAccounts(d);setError("");}catch(e){setError(e instanceof Error?e.message:"loadError");}}
  useEffect(()=>{void load();},[]);
  return <div className="portal-manager"><div className="portal-manager-top"><p className="portal-manager-intro">{t("portalManagerHint")}</p><a className="button secondary" href="/portal" target="_blank" rel="noreferrer">{t("portalOpen")}<ExternalLink size={15}/></a></div><button className="text-button" disabled={busy} onClick={()=>{void refresh();void load();}}><RefreshCw size={15}/>{t("refresh")}</button>{error&&<p role="alert">{t(error)}</p>}
    <section className="panel"><div className="panel-heading"><h2>{t("portalRequests")} ({requests.length})</h2></div>{requests.length?requests.map(o=><article className="portal-request-card" key={o.id}><h3>{o.customerName} · #{orderCode(o.id)}</h3><p>{o.date} · {o.time} · {o.address} · {o.phone}</p><div className="portal-request-items">{o.items.map(i=><div key={i.id}><span>{i[lang]} ×{i.quantity}</span><strong>{money(i.price*i.quantity)}</strong></div>)}</div><div className="fulfill-summary"><p>{t(o.fulfillmentMode==="pickup"?"fulfillPickup":"fulfillDelivery")} · {t("fulfillShipping")}: {money(o.deliveryFee??0)}</p><strong>{t("fulfillGrandTotal")}: {money(total(o))}</strong></div>{o.note&&<p>{o.note}</p>}<button className="text-button" disabled={busy} onClick={()=>onOrder(o)}>{t("open")}</button><OrderRequestReview key={o.id+":"+o.revision} order={o} lang={lang} busy={busy} mutate={mutate}/></article>):<p className="portal-manager-empty">{t("portalNoRequests")}</p>}</section>
    <section className="panel"><div className="panel-heading"><h2>{t("portalAccounts")} ({accounts.length})</h2></div><div className="portal-accounts">{accounts.length?accounts.map(a=><div className="portal-account-row" key={a.userId}><div><strong>{a.name}</strong><small>{a.address} · {a.phone}</small><small>{t(a.active?"portalEnabled":"portalBlocked")}</small></div>{isAdmin(role)&&<TemporaryPasswordButton userId={a.userId} name={a.name} lang={lang} disabled={busy}/>}{isAdmin(role)&&<button className="button secondary" disabled={busy} onClick={async()=>{if(await mutate("portal/accounts/state",{userId:a.userId,revision:a.revision,active:a.active?0:1}))await load();}}>{t(a.active?"portalBlock":"portalEnable")}</button>}</div>):<p className="portal-manager-intro">{t("portalNoAccounts")}</p>}</div></section>
  </div>;
}
export function OrderRequestReview({order,lang,busy,mutate}:{order:Order;lang:Language;busy:boolean;mutate:Props["mutate"]}){
  const [note,setNote]=useState(""),t=(k:string)=>messages[lang][k]??k;
  return <form className="portal-review-form" onSubmit={e=>{e.preventDefault();void mutate("orders/state",{id:order.id,revision:order.revision,field:"status",value:"confirmed",note});}}><label>{t("portalReviewNote")}<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><p>{t("portalReviewHint")}</p><div><button className="button" disabled={busy}><Check size={15}/>{t("portalApprove")}</button><button type="button" className="button secondary" disabled={busy||!note.trim()} onClick={()=>void mutate("orders/state",{id:order.id,revision:order.revision,field:"status",value:"rejected",note})}>{t("portalReject")}</button></div></form>;
}
