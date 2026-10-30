"use client";
import {useCallback,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Printer,RefreshCw,ChevronLeft,ChevronRight,PackageCheck} from 'lucide-react';
import {messages} from '@/src/modules/shared/i18n';
import {today,orderCode,canCheckPacking,type Language} from '@/src/modules/shared/domain';
import {addDays,validDay} from '@/src/modules/menu/domain';
import {workPlan,type PackingData,type PackingOrder} from '@/src/modules/packing/domain';
import type {ConsumerLabel} from '@/src/modules/labels/domain';
import {PrintableLabel} from './consumer-label';
import {LabelFixDialog} from './label-fix-dialog';
export default function PackingWorkspace({lang,refresh,initialDate,initialOrderId='',canEditLabels=false}:{lang:Language;refresh:()=>Promise<void>;initialDate?:string;initialOrderId?:string;canEditLabels?:boolean}){
 const [date,setDate]=useState(()=>initialDate??today()),[data,setData]=useState<PackingData|null>(null),[orderId,setOrderId]=useState(initialOrderId),[view,setView]=useState<'plan'|'orders'|'labels'|'consumer'>(initialOrderId?'orders':'plan'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false),[version,setVersion]=useState(0);
 const t=(k:string)=>messages[lang][k]??k;
 const reload=useCallback(()=>{setError('');setSuccess(false);setVersion(v=>v+1);},[]);
 useEffect(()=>{let ignore=false;setLoading(true);setData(previous=>previous?.date===date?previous:null);
  void (async()=>{try{const r=await fetch('/api/packing?date='+encodeURIComponent(date),{cache:'no-store'}),d=await r.json() as PackingData&{error?:string};if(!r.ok)throw Error(d.error??'loadError');if(!ignore)setData(d);}catch(e){if(!ignore){setData(null);setError((e as Error).message);}}finally{if(!ignore)setLoading(false);}})();return ()=>{ignore=true;};
 },[date,version]);
 async function save(o:PackingOrder,itemIds:string[]){setBusy(true);setError('');setSuccess(false);try{const r=await fetch('/api/packing/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.id,revision:o.revision,itemIds})}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error??'saveError');setVersion(v=>v+1);await refresh();setSuccess(true);}catch(e){setError((e as Error).message);setVersion(v=>v+1);}finally{setBusy(false);}}
 const displayOrders=(data?.orders??[]).filter(o=>!orderId||o.id===orderId);
 const rows=workPlan(data?.orders??[]),totals=rows.reduce((a,r)=>({quantity:a.quantity+r.quantity,ready:a.ready+r.ready,packed:a.packed+r.packed}),{quantity:0,ready:0,packed:0});
 const allergens=(value:string)=>value?value.split(',').map(t).join(', '):t('packingNoAllergenData');
 return <section className={'packing-workspace packing-view-'+view} aria-label={t('packing')}>
  <div className="packing-toolbar packing-no-print"><div className="packing-date"><button className="button secondary" aria-label={t('previous')} disabled={busy||loading||date<=addDays(today(),-90)} onClick={()=>{setError('');setSuccess(false);setOrderId('');setDate(addDays(date,-1));}}><ChevronLeft size={16}/></button><label>{t('date')}<input type="date" min={addDays(today(),-90)} max={addDays(today(),90)} value={date} disabled={busy||loading} onChange={e=>{if(!validDay(e.target.value))return;setError('');setSuccess(false);setOrderId('');setDate(e.target.value);}}/></label><button className="button secondary" aria-label={t('next')} disabled={busy||loading||date>=addDays(today(),90)} onClick={()=>{setError('');setSuccess(false);setOrderId('');setDate(addDays(date,1));}}><ChevronRight size={16}/></button></div><button className="button secondary" disabled={busy||loading} onClick={reload}><RefreshCw size={16}/>{t('refresh')}</button><button className="button secondary" disabled={busy||loading||!data?.orders.length} onClick={()=>window.print()}><Printer size={16}/>{t('packingPrint')}</button></div>
  <p className="packing-intro packing-no-print">{t('packingIntro')}</p>
  <div className="packing-tabs packing-no-print" role="group" aria-label={t('packing')}>{(['plan','orders','labels','consumer'] as const).map(v=><button className={'button '+(view===v?'':'secondary')} aria-pressed={view===v} disabled={busy} key={v} onClick={()=>setView(v)}>{t(v==='plan'?'packingPlan':v==='orders'?'packingOrders':v==='labels'?'packingLabels':'packingConsumerLabels')}</button>)}</div>
  {view!=='plan'&&data&&<label className="packing-filter packing-no-print">{t('packingFilter')}<select disabled={busy||loading} value={orderId} onChange={e=>setOrderId(e.target.value)}><option value="">{t('all')}</option>{data.orders.map(o=><option key={o.id} value={o.id}>#{orderCode(o.id)} · {o.time} · {o.customerName}</option>)}</select></label>}
  {error&&<p role="alert" className="portal-alert packing-no-print">{t(error)}</p>}{success&&<p role="status" className="portal-success packing-no-print">{t('packingSaved')}</p>}{loading&&<p role="status">{t('loading')}</p>}
  {data&&<div className="packing-print-area"><div className="packing-print-heading"><h2>{t(view==='plan'?'packingPlan':view==='orders'?'packingOrders':view==='labels'?'packingLabels':'packingConsumerLabels')} · {date}</h2><small>{t('portalTimezone')}</small></div>
   {!data.orders.length?<p className="panel packing-empty">{t('packingEmpty')}</p>:<>
   {view==='plan'&&<><div className="packing-summary">{[['packingTotal',totals.quantity],['packingPrepared',totals.ready],['packingPacked',totals.packed]].map(([key,n])=><div className="panel" key={key}><small>{t(String(key))}</small><strong>{n}</strong></div>)}</div><div className="panel packing-table-wrap"><table className="packing-table"><thead><tr><th>{t('time')}</th><th>{t('packingDish')}</th><th>{t('packingTotal')}</th><th>{t('packingPrepared')}</th><th>{t('packingPacked')}</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{r.time}{r.windowEnd?'–'+r.windowEnd:''}</td><td><strong>{r[lang]}</strong><small>{t('allergens')}: {allergens(r.allergens)}</small></td><td>{r.quantity}</td><td>{r.ready}</td><td>{r.packed}</td></tr>)}</tbody></table></div><p className="packing-hint">{t('packingAllergensHint')}</p></>}
   {view==='orders'&&<><p className="packing-hint packing-no-print">{t('packingHint')}</p><div className="packing-order-list">{displayOrders.map(o=><PackingCard key={o.id+':'+o.revision} order={o} lang={lang} busy={busy||loading} save={save}/>)}</div></>}
   {view==='labels'&&<><p className="packing-hint packing-no-print">{t('packingLabelHint')}</p><div className="packing-label-grid">{displayOrders.flatMap(o=>o.items.map(i=><article className="packing-label" key={i.id}><header><strong>#{orderCode(o.id)}</strong><span>{o.date} · {o.time}{o.windowEnd?'–'+o.windowEnd:''}</span></header><h3>{o.customerName}</h3><p>{t(o.mode==='pickup'?'fulfillPickup':'fulfillDelivery')}</p><h4>{i[lang]}</h4><strong className="packing-label-portions">{i.quantity} {t('packingPortions')}</strong><p>{t('allergens')}: {allergens(i.allergens)}</p><small>{t(o.packingReady===1?'packingComplete':'packingIncomplete')}</small></article>))}</div></>}
   {view==='consumer'&&<ConsumerLabels key={date+':'+orderId+':'+version} date={date} orderId={orderId} lang={lang} canEdit={canEditLabels}/>}
   </>}
  </div>}
 </section>;
}
// Nap, rendelés vagy frissítés változásakor a szülő új kulccsal újra létrehozza (tiszta állapot).
function ConsumerLabels({date,orderId,lang,canEdit}:{date:string;orderId:string;lang:Language;canEdit:boolean}){
 // Kijelölt címkék: tétel → példányszám. Alapból egyik sincs kijelölve, a felhasználó választ.
 const [labels,setLabels]=useState<ConsumerLabel[]|null>(null),[error,setError]=useState(''),[chosen,setChosen]=useState<Record<string,number>>({}),[fixing,setFixing]=useState<ConsumerLabel|null>(null),[reload,setReload]=useState(0),t=(k:string)=>messages[lang][k]??k,ro=(k:string)=>messages.ro[k]??k;
 useEffect(()=>{let ignore=false;
  void (async()=>{try{const r=await fetch('/api/labels?date='+encodeURIComponent(date)+(orderId?'&orderId='+encodeURIComponent(orderId):''),{cache:'no-store'}),d=await r.json() as {labels?:ConsumerLabel[];error?:string};if(!r.ok)throw Error(d.error??'loadError');if(!ignore)setLabels(d.labels??[]);}catch(e){if(!ignore)setError((e as Error).message);}})();return ()=>{ignore=true;};
 },[date,orderId,reload]);
 if(error)return <p role="alert" className="portal-alert">{t(error)}</p>;
 if(!labels)return <p role="status">{t('loading')}</p>;
 if(!labels.length)return <p className="panel packing-empty">{t('labelEmpty')}</p>;
 const selected=labels.filter(l=>chosen[l.itemId]!==undefined),total=selected.reduce((n,l)=>n+(chosen[l.itemId]??0),0);
 const toggle=(l:ConsumerLabel,on:boolean)=>setChosen(c=>{const next={...c};if(on)next[l.itemId]=l.copies;else delete next[l.itemId];return next;});
 const setCopies=(l:ConsumerLabel,value:string)=>{const n=Math.max(1,Math.min(100,Math.round(Number(value))||1));setChosen(c=>({...c,[l.itemId]:n}));};
 // Ételenként egyszer jelezzük, mi hiányzik – csak a kijelölt címkéknél.
 const missing=new Map<string,ConsumerLabel>();for(const l of selected)if(l.missing.length&&!missing.has(l.productId))missing.set(l.productId,l);
 return <>
  <p className="packing-hint packing-no-print">{t('labelConsumerHint')}</p>
  {missing.size>0&&<div className="label-missing packing-no-print" role="alert"><strong>{t('labelMissingTitle')}</strong><ul>{[...missing.values()].map(m=><li key={m.productId}>{canEdit?<button type="button" className="label-missing-fix" onClick={()=>setFixing(m)}><b>{m.name[lang]}</b>: {m.missing.map(k=>t('labelMissing_'+k)).join(', ')}<span>{t('labelFixOpen')}</span></button>:<><b>{m.name[lang]}</b>: {m.missing.map(k=>t('labelMissing_'+k)).join(', ')}</>}</li>)}</ul>{!canEdit&&<small>{t('labelFixAskAdmin')}</small>}</div>}
  {fixing&&<LabelFixDialog productId={fixing.productId} name={fixing.name[lang]} missing={fixing.missing} lang={lang} close={()=>setFixing(null)} saved={()=>{setFixing(null);setReload(n=>n+1);}}/>}
  <div className="label-select-bar packing-no-print"><button className="button secondary" onClick={()=>setChosen(Object.fromEntries(labels.map(l=>[l.itemId,l.copies])))}>{t('labelSelectAll')}</button><button className="button secondary" disabled={!selected.length} onClick={()=>setChosen({})}>{t('labelSelectNone')}</button><button className="button" disabled={!total} onClick={()=>window.print()}><Printer size={16}/>{t('labelPrintSelected')} ({total})</button></div>
  {!selected.length&&<p className="packing-hint packing-no-print">{t('labelSelectHint')}</p>}
  <div className="consumer-label-grid">{labels.map(l=>{const on=chosen[l.itemId]!==undefined;return <div className={'consumer-label-preview'+(on?' is-selected':'')} key={l.itemId}><div className="label-choose packing-no-print"><label><input type="checkbox" checked={on} onChange={e=>toggle(l,e.target.checked)}/>{t('labelGenerate')}</label>{on&&<label>{t('labelCopiesInput')}<input type="number" min={1} max={100} step={1} value={chosen[l.itemId]} onChange={e=>setCopies(l,e.target.value)}/></label>}</div><small>#{l.orderCode} · {l.copies} {t('packingPortions')}</small><PrintableLabel label={l} t={ro}/></div>;})}</div>
  {/* Nyomtatáskor csak ez látszik: a kijelölt címkék, példányonként egy 62 mm-es oldal. */}
  {createPortal(<div className="consumer-print-root">{selected.flatMap(l=>Array.from({length:chosen[l.itemId]??0},(_,i)=><PrintableLabel key={l.itemId+':'+i} label={l} t={ro}/>))}</div>,document.body)}
 </>;
}
function PackingCard({order:o,lang,busy,save}:{order:PackingOrder;lang:Language;busy:boolean;save:(o:PackingOrder,itemIds:string[])=>Promise<void>}){
 const [selected,setSelected]=useState(o.checkedItemIds),t=(k:string)=>messages[lang][k]??k,editable=canCheckPacking({...o,status:'confirmed'}),changed=JSON.stringify([...selected].sort())!==JSON.stringify([...o.checkedItemIds].sort());
 return <article className="panel packing-order"><div className="packing-order-heading"><strong>#{orderCode(o.id)}</strong><span>{o.time}{o.windowEnd?'–'+o.windowEnd:''} · {t(o.mode==='pickup'?'fulfillPickup':'fulfillDelivery')}</span><span className={'badge '+(o.packingReady===1?'ready':'queued')}>{t(o.packingReady===1?'packingComplete':'packingIncomplete')}</span></div><h3>{o.customerName}</h3><p className="packing-state">{t(o.production)} · {t(o.delivery)}{o.packingCheckedAt?' · '+new Intl.DateTimeFormat(lang==='hu'?'hu-HU':'ro-RO',{timeZone:'Europe/Bucharest',dateStyle:'short',timeStyle:'short'}).format(new Date(o.packingCheckedAt)):''}</p>{o.note&&<p className="packing-order-note">{o.note}</p>}<fieldset disabled={busy||!editable}><legend>{t('packingCheck')}</legend>{o.items.map(i=><label className="packing-check-row" key={i.id}><input type="checkbox" checked={selected.includes(i.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,i.id]:s.filter(id=>id!==i.id))}/><span><strong>{i.quantity} × {i[lang]}</strong><small>{t('allergens')}: {i.allergens?i.allergens.split(',').map(t).join(', '):t('packingNoAllergenData')}</small></span></label>)}</fieldset><footer>{editable?<button className="button packing-no-print" disabled={busy||!changed} onClick={()=>void save(o,selected)}><PackageCheck size={16}/>{t('packingSave')}</button>:<small>{t(o.production!=='ready'?'packingWaiting':'packingLocked')}</small>}{editable&&o.packingReady===1&&!changed&&<strong className="packing-go">{t(o.mode==='pickup'?'packingPickupReady':o.courierAssigned?'packingReadyDispatch':'packingNeedCourier')}</strong>}</footer></article>;
}
