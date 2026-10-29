"use client";
import {useCallback,useEffect,useState} from 'react';
import {messages} from '@/src/modules/shared/i18n';
import type {Language} from '@/src/modules/shared/domain';
import type {CourierAccounts} from '@/src/modules/courier/domain';
export default function CourierAccountBindings({lang,refreshKey}:{lang:Language;refreshKey:string}){
  const [data,setData]=useState<CourierAccounts>({couriers:[],members:[]}),[busy,setBusy]=useState(false),[error,setError]=useState(''),t=(k:string)=>messages[lang][k]??k;
  const load=useCallback(async()=>{try{const r=await fetch('/api/courier/accounts',{cache:'no-store'}),d=await r.json() as CourierAccounts&{error?:string};if(!r.ok)throw Error(d.error??'loadError');setData(d);setError('');}catch(e){setError((e as Error).message);}},[]);
  useEffect(()=>{void load();},[load,refreshKey]);
  async function save(courierId:string,revision:number,userId:string|null){setBusy(true);setError('');try{const r=await fetch('/api/courier/bind',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courierId,revision,userId})}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error??'saveError');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="courier-bindings"><div className="panel-heading"><h2>{t('courierBindings')}</h2><button className="button secondary" disabled={busy} onClick={()=>void load()}>{t('refresh')}</button></div><p>{t('courierSetup')}</p><p>{t('courierBindingHint')}</p>{error&&<p role="alert">{t(error)}</p>}{!data.members.length&&<p>{t('courierNoEligible')}</p>}{!data.couriers.length&&<p>{t('courierNoMasters')}</p>}{data.couriers.map(c=><BindingRow key={c.id+':'+c.bindingRevision} courier={c} members={data.members} lang={lang} busy={busy} save={userId=>save(c.id,c.bindingRevision,userId)}/>)}<a className="button secondary" href="/courier" target="_blank" rel="noreferrer">{t('courierOpen')}</a></section>;
}
function BindingRow({courier,members,lang,busy,save}:{courier:CourierAccounts['couriers'][number];members:CourierAccounts['members'];lang:Language;busy:boolean;save:(userId:string|null)=>Promise<void>}){
  const [userId,setUserId]=useState(courier.userId??''),t=(k:string)=>messages[lang][k]??k;
  return <form className="courier-binding-row" onSubmit={e=>{e.preventDefault();void save(userId||null);}}><strong>{courier.name}</strong><label>{t('courierAccount')}<select value={userId} disabled={busy} onChange={e=>setUserId(e.target.value)}><option value="">{t('courierUnbound')}</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name} · {m.email}</option>)}</select></label><button className="button secondary" disabled={busy||userId===(courier.userId??'')}>{t('courierBindSave')}</button></form>;
}
