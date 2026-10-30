"use client";
import {useEffect,useState} from "react";
import {ExternalLink,Check,RefreshCw,Search} from "lucide-react";
import {messages} from "@/src/modules/shared/i18n";
import {isAdmin,type Role} from "@/src/modules/access/domain";
import {normalizeSearch,type AppData,type Language,type Order} from "@/src/modules/shared/domain";
import type {PortalAccount} from "@/src/modules/portal/domain";
import {TemporaryPasswordButton} from "./auth-page";
type Props={data:AppData;lang:Language;role:Role;busy:boolean;mutate:(path:string,body:unknown)=>Promise<boolean>;refresh:()=>Promise<void>;onOrder:(o:Order)=>void};
// v37: a visszaigazolásra váró kérések a Rendelések oldalon vannak (Visszaigazolásra vár szűrő); itt ügyfélkereső van helyettük.
export default function PortalManagement({lang,role,busy,mutate,refresh}:Props){
  const t=(k:string)=>messages[lang][k]??k,[accounts,setAccounts]=useState<PortalAccount[]>([]),[error,setError]=useState(""),[query,setQuery]=useState("");
  // Ékezet- és kisbetű-független keresés névre, címre, telefonra.
  const q=normalizeSearch(query.trim()),shown=q?accounts.filter(a=>normalizeSearch([a.name,a.address,a.phone].join(" ")).includes(q)):accounts;
  async function load(){try{const r=await fetch("/api/portal/accounts",{cache:"no-store"});const d=await r.json() as PortalAccount[]&{error?:string};if(!r.ok)throw new Error(d.error??"loadError");setAccounts(d);setError("");}catch(e){setError(e instanceof Error?e.message:"loadError");}}
  useEffect(()=>{void load();},[]);
  return <div className="portal-manager"><div className="portal-manager-top"><p className="portal-manager-intro">{t("portalManagerHint")}</p><a className="button secondary" href="/portal" target="_blank" rel="noreferrer">{t("portalOpen")}<ExternalLink size={15}/></a></div><button className="text-button" disabled={busy} onClick={()=>{void refresh();void load();}}><RefreshCw size={15}/>{t("refresh")}</button>{error&&<p role="alert">{t(error)}</p>}
    <section className="panel"><div className="panel-heading"><h2>{t("portalAccounts")} ({q?shown.length+" / ":""}{accounts.length})</h2></div><label className="search-box portal-account-search"><Search size={17}/><input type="search" placeholder={t("portalSearchCustomers")} aria-label={t("portalSearchCustomers")} value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="portal-accounts">{shown.length?shown.map(a=><div className="portal-account-row" key={a.userId}><div><strong>{a.name}</strong><small>{a.address} · {a.phone}</small><small>{t(a.active?"portalEnabled":"portalBlocked")}</small></div>{isAdmin(role)&&<TemporaryPasswordButton userId={a.userId} name={a.name} lang={lang} disabled={busy}/>}{isAdmin(role)&&<button className="button secondary" disabled={busy} onClick={async()=>{if(await mutate("portal/accounts/state",{userId:a.userId,revision:a.revision,active:a.active?0:1}))await load();}}>{t(a.active?"portalBlock":"portalEnable")}</button>}</div>):<p className="portal-manager-intro">{t(q?"portalNoSearchResult":"portalNoAccounts")}</p>}</div></section>
  </div>;
}
export function OrderRequestReview({order,lang,busy,mutate}:{order:Order;lang:Language;busy:boolean;mutate:Props["mutate"]}){
  const [note,setNote]=useState(""),t=(k:string)=>messages[lang][k]??k;
  return <form className="portal-review-form" onSubmit={e=>{e.preventDefault();void mutate("orders/state",{id:order.id,revision:order.revision,field:"status",value:"confirmed",note});}}><label>{t("portalReviewNote")}<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><p>{t("portalReviewHint")}</p><div><button className="button" disabled={busy}><Check size={15}/>{t("portalApprove")}</button><button type="button" className="button secondary" disabled={busy||!note.trim()} onClick={()=>void mutate("orders/state",{id:order.id,revision:order.revision,field:"status",value:"rejected",note})}>{t("portalReject")}</button></div></form>;
}
