"use client";
import {useCallback,useEffect,useState} from 'react';
import {Truck,MapPin,Phone,RefreshCw,CheckCircle2,ArrowRight,LogOut,Wallet,FileText} from 'lucide-react';
import {messages} from '@/src/modules/shared/i18n';
import {today,orderCode,type Language} from '@/src/modules/shared/domain';
import {addDays} from '@/src/modules/menu/domain';
import type {Session} from '@/src/modules/access/domain';
import {navigationUrl,phoneUrl,type CourierTask,type CourierTasks} from '@/src/modules/courier/domain';
export default function CourierPortal(){
  const [lang,setLang]=useState<Language>('hu'),[date,setDate]=useState(today),[session,setSession]=useState<Session|null>(null),[data,setData]=useState<CourierTasks|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false),[revision,setRevision]=useState(0);
  const t=(k:string)=>messages[lang][k]??k;
  useEffect(()=>{const l=localStorage.getItem('konyha-language');if(l==='hu'||l==='ro')setLang(l);},[]);
  useEffect(()=>{document.documentElement.lang=lang;localStorage.setItem('konyha-language',lang);},[lang]);
  const refresh=useCallback(()=>{setError('');setSuccess(false);setRevision(n=>n+1);},[]);
  useEffect(()=>{let ignore=false;setLoading(true);setData(null);
    void (async()=>{try{const r=await fetch('/api/session',{cache:'no-store'}),s=await r.json() as Session&{error?:string};if(r.status===401){if(!ignore)setSession(null);return;}if(!r.ok)throw Error(s.error??'loadError');if(!ignore)setSession(s);if(s.role!=='courier')return;
      const tasks=await fetch('/api/courier/tasks?date='+encodeURIComponent(date),{cache:'no-store'}),d=await tasks.json() as CourierTasks&{error?:string};if(!tasks.ok)throw Error(d.error??'loadError');if(!ignore)setData(d);
    }catch(e){if(!ignore){setData(null);setError(e instanceof Error?e.message:'loadError');}}finally{if(!ignore)setLoading(false);}})();return ()=>{ignore=true;};
  },[date,revision]);
  async function requestAccess(){setBusy(true);setError('');try{const r=await fetch('/api/access/request',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),s=await r.json() as Session&{error?:string};if(!r.ok)throw Error(s.error??'saveError');setSession(s);refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function act(body:unknown){setBusy(true);setSuccess(false);setError('');try{const r=await fetch('/api/courier/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error??'saveError');setRevision(n=>n+1);setSuccess(true);return true;}catch(e){setData(null);setError((e as Error).message);return false;}finally{setBusy(false);}}
  const active=data?.tasks.filter(o=>o.delivery!=='delivered')??[],completed=data?.tasks.filter(o=>o.delivery==='delivered')??[];
  return <div className="courier-page"><header className="courier-header"><a className="courier-brand" href="/courier"><img src="/logo.png" alt="Gastro-Garage" width={80} height={80}/></a><div className="courier-title"><h1>{t('courierMobile')}</h1>{session&&<p>{session.name}<span className="courier-role"> · {t('role_'+session.role)}</span></p>}</div><div className="language-switch" aria-label={t('language')}>{(['hu','ro'] as const).map(l=><button key={l} aria-pressed={lang===l} className={lang===l?'selected':''} onClick={()=>setLang(l)}>{l.toUpperCase()}</button>)}</div>{session&&<a className="courier-signout" href="/signout?return_to=/courier" aria-label={t('signOut')}><LogOut size={20}/><span>{t('signOut')}</span></a>}</header><main className="courier-content"><p className="courier-subtitle courier-intro">{t('courierIntro')}</p>{error&&<div role="alert" className="portal-alert"><span>{t(error)}</span><button className="button secondary" disabled={busy||loading} onClick={refresh}>{t('refresh')}</button></div>}{success&&<p role="status" className="portal-success"><CheckCircle2 size={18}/>{t('courierSaved')}</p>}
    {loading&&<p role="status">{t('loading')}</p>}{!loading&&!session&&<section className="panel courier-access"><p>{t('courierOnly')}</p><a className="button" href="/signin?return_to=/courier">{t('signIn')}<ArrowRight size={16}/></a></section>}{!loading&&session&&session.role!=='courier'&&<section className="panel courier-access"><p>{t(session.role==='disabled'?'accessBlocked':'courierAccessHint')}</p>{session.role==='pending'&&<button className="button" disabled={busy} onClick={()=>void requestAccess()}>{t('accessRequest')}</button>}<button className="button secondary" disabled={busy} onClick={refresh}>{t('accessRefresh')}</button><a href="/">{t('portalInternal')}</a></section>}
    {session?.role==='courier'&&<><section className="courier-toolbar"><label>{t('date')}<input type="date" min={addDays(today(),-30)} max={addDays(today(),30)} required disabled={busy||loading} value={date} onChange={e=>{setDate(e.target.value);setError('');setSuccess(false);}}/></label><button className="button secondary" disabled={busy||loading} onClick={refresh}><RefreshCw size={17}/>{t('refresh')}</button></section><p className="courier-subtitle">{t('courierRefreshHint')}</p>{data&&<><div className="courier-day-summary"><Truck size={28}/><div><strong>{data.courier.name}</strong>{data.courier.vehicle&&<span>{data.courier.vehicle}</span>}</div><span className="courier-day-count"><b>{active.length}</b>{t('courierTaskCount')}</span></div>{data.cashOnHand>0&&<p className="courier-cash"><Wallet size={18}/>{t('courierCashOnHand')}: <b>{lei(data.cashOnHand)}</b><small>{t('courierCashHandoverHint')}</small></p>}<h2>{t('courierCurrent')}</h2>{active.length?<div className="courier-task-list">{active.map(o=><TaskCard key={o.id+':'+o.revision} task={o} viewDate={date} lang={lang} busy={busy||loading} act={act}/>)}</div>:<p className="courier-empty">{t('courierNoTasks')}</p>}{completed.length>0&&<details className="courier-completed"><summary>{t('courierCompleted')} ({completed.length})</summary><div className="courier-task-list">{completed.map(o=><TaskCard key={o.id+':'+o.revision} task={o} viewDate={date} lang={lang} busy={busy||loading} act={act}/>)}</div></details>}</>}</>}
  </main></div>;
}
const lei=(bani:number)=>(bani/100).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2})+' lei';
function TaskCard({task,viewDate,lang,busy,act}:{task:CourierTask;viewDate:string;lang:Language;busy:boolean;act:(body:unknown)=>Promise<boolean>}){
  const [note,setNote]=useState(''),[pending,setPending]=useState<{requestId:string;orderId:string;revision:number;value:string;note:string;payment?:{method:string;amount:number}|null}|null>(null),t=(k:string)=>messages[lang][k]??k;
  // v76: kézbesítéskor a beszedett összeg (alapból a hátralék); „már fizetett” esetén nincs befizetés.
  const [method,setMethod]=useState<'cash'|'card'|'none'>(task.expectedPaymentMethod==='card'?'card':'cash'),[amount,setAmount]=useState((task.due/100).toFixed(2).replace('.',','));
  const amountBani=/^\d{1,6}([.,]\d{1,2})?$/.test(amount.trim())?Math.round(Number(amount.trim().replace(',','.'))*100):NaN;
  const payment=(value:string)=>value==='delivered'&&task.due>0&&method!=='none'?{method,amount:amountBani}:null;
  async function send(value:string){const p=payment(value),body=pending&&pending.value===value&&pending.note===note.trim()&&JSON.stringify(pending.payment??null)===JSON.stringify(p)?pending:{requestId:crypto.randomUUID(),orderId:task.id,revision:task.revision,value,note:note.trim(),...(p?{payment:p}:{})};setPending(body);await act(body);}
  const payInvalid=task.due>0&&method!=='none'&&(!Number.isInteger(amountBani)||amountBani<=0||amountBani>task.due);
  const phone=phoneUrl(task.phone);
  // v89: fent név és cím (mellette kicsiben idő és állapot), egy sorban navigáció, hívás, aviz; alatta a nagy fő gomb.
  // Minden más (tételek, megjegyzés, sikertelen kézbesítés, előzmények) a „Részletek” fül alatt.
  const fmt=(iso:string)=>new Intl.DateTimeFormat(lang==='hu'?'hu-HU':'ro-RO',{timeZone:'Europe/Bucharest',dateStyle:'short',timeStyle:'short'}).format(new Date(iso));
  return <article className="panel courier-task">
   <div className="courier-head"><div className="courier-who"><h3>{task.customerName}</h3><p className="courier-address">{task.address}</p></div><div className="courier-meta"><strong>{task.time}{task.windowEnd?'–'+task.windowEnd:''}</strong><span className={'badge '+task.delivery}>{t(task.delivery)}</span></div></div>
   {task.date<today()&&task.delivery!=='delivered'&&<p className="courier-overdue">{t('courierOverdue')} · {task.date}</p>}
   <div className="courier-links courier-row"><a className="button secondary" href={navigationUrl(task.address)} target="_blank" rel="noreferrer"><MapPin size={18}/>{t('courierNavigate')}</a>{phone&&<a className="button secondary" href={phone}><Phone size={18}/>{t('courierCall')}</a>}{task.avizAvailable&&<a className="button secondary" href={'/api/courier/aviz?orderId='+encodeURIComponent(task.id)+'&date='+encodeURIComponent(viewDate)} target="_blank" rel="noreferrer"><FileText size={18}/>{t('courierAviz')}</a>}</div>
   {task.delivery!=='delivered'&&<div className="courier-outcome">
    {['pending','failed'].includes(task.delivery)&&(task.production==='ready'?<button className="button courier-main" disabled={busy} onClick={()=>void send('transit')}><Truck size={20}/>{t('courierDepart')}</button>:<p>{t('courierWaitReady')}</p>)}
    {task.onAccount&&<p className="courier-cash">{t('courierOnAccount')}</p>}
    {task.delivery==='transit'&&task.due>0&&<div className="courier-payment"><p>{t('courierDue')}: <b>{lei(task.due)}</b></p>{(()=>{const radios=<div className="courier-pay-methods">{(['cash','card','none'] as const).map(m=><label key={m}><input type="radio" name={'pay-'+task.id} checked={method===m} disabled={busy} onChange={()=>setMethod(m)}/>{t('courierPay_'+m)}</label>)}</div>;
    // v90: ha a rendeléskor már megadták a fizetési módot, azt mutatjuk; változtatni csak „Másképp fizetett” alatt lehet.
    return task.expectedPaymentMethod?<><p className="courier-pay-known">{t('courierPay_'+method)}</p><details className="courier-pay-other"><summary>{t('courierPayOther')}</summary>{radios}</details></>:radios;})()}{method!=='none'&&<label>{t('courierPaidAmount')}<input inputMode="decimal" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>}{payInvalid&&<small className="courier-overdue">{t('PAYMENT_TOO_MUCH')}</small>}</div>}
    {task.delivery==='transit'&&<button className="button courier-main" disabled={busy||payInvalid} onClick={()=>void send('delivered')}><CheckCircle2 size={20}/>{t('markDelivered')}</button>}
   </div>}
   <details className="courier-more"><summary>{t('courierMore')}</summary>
    <p className="courier-code">#{orderCode(task.id)}</p>
    <div className="courier-items">{task.items.map((i,index)=><div key={index}><strong>{i.quantity} × {i[lang]}</strong>{i.allergens&&<small>{t('allergens')}: {i.allergens.split(',').map(t).join(', ')}</small>}</div>)}</div>
    {task.note&&<p className="courier-note">{task.note}</p>}
    {!task.avizAvailable&&task.delivery!=='delivered'&&<small>{t('courierAviz')}: {t('courierAvizPending')}</small>}
    {task.delivery==='transit'&&<div className="courier-fail"><label>{t('courierOutcomeNote')}<textarea maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label><button className="button secondary" disabled={busy||!note.trim()} onClick={()=>void send('failed')}>{t('markFailed')}</button></div>}
    <small className="courier-map-hint">{t('courierMapsHint')}</small>
    {task.events.length>0&&<div className="courier-history">{task.events.map((e,i)=><p key={i}><strong>{t(e.kind)}</strong> · {fmt(e.createdAt)}{e.note&&<span>{e.note}</span>}</p>)}</div>}
   </details>
  </article>;
}
