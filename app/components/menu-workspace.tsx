"use client";
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {DateTime24} from './time-input';
import {messages} from '@/src/modules/shared/i18n';
import {today,DAILY_CATEGORIES,type Product,type Language} from '@/src/modules/shared/domain';
import {addDays,kitchenWallTime,type MenuData,type MenuSet} from '@/src/modules/menu/domain';
const empty:MenuData={days:[],lines:[],settings:{setPrice:0,revision:0}};
export default function MenuWorkspace({products,lang}:{products:Product[];lang:Language}){
  const [data,setData]=useState<MenuData>(empty),[start,setStart]=useState(today),[date,setDate]=useState(()=>addDays(today(),1)),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const t=(k:string)=>messages[lang][k]??k;
  const load=useCallback(async()=>{setLoading(true);try{const r=await fetch('/api/menu',{cache:'no-store'}),d=await r.json() as MenuData&{error?:string};if(!r.ok)throw Error(d.error??'loadError');setData(d);return true;}catch(e){setError(e instanceof Error?e.message:'loadError');return false;}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function save(path:string,body:unknown,message:string){setBusy(true);setError('');setSuccess('');try{const r=await fetch('/api/menu/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error??'saveError');if(await load())setSuccess(message);}catch(e){setError(e instanceof Error?e.message:'saveError');}finally{setBusy(false);}}
  return <div className="menu-workspace"><p>{t('menuIntro')}</p>{error&&<p role="alert" className="portal-alert">{t(error)}</p>}{success&&<p role="status" className="portal-success">{t(success)}</p>}{!loading&&<SetPriceForm key={data.settings.revision} settings={data.settings} lang={lang} busy={busy} save={body=>save('settings',body,'menuSetPriceSaved')}/>}<div className="menu-toolbar"><button className="button secondary" disabled={loading||busy} onClick={()=>{setSuccess('');void load();}}>{t('refresh')}</button><button className="button secondary" disabled={start<=today()||busy} onClick={()=>setStart(addDays(start,-7)<today()?today():addDays(start,-7))}>{t('menuPreviousWeek')}</button><strong>{t('menuWeek')}</strong><button className="button secondary" disabled={start>=addDays(today(),84)||busy} onClick={()=>setStart(addDays(start,7))}>{t('menuNextWeek')}</button></div><div className="menu-week">{Array.from({length:7},(_,i)=>addDays(start,i)).map(day=>{const d=data.days.find(d=>d.date===day),lines=data.lines.filter(l=>l.date===day);return <button key={day} className={day===date?'selected':''} aria-pressed={day===date} disabled={busy} onClick={()=>{setDate(day);setSuccess('');setError('');}}><strong>{new Intl.DateTimeFormat(lang==='hu'?'hu-HU':'ro-RO',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'))}</strong><span>{!d?t('menuNew'):d.active&&Date.parse(d.cutoffAt)>Date.now()?t('menuOpen'):t('menuClosed')}</span>{d?.setSoupId&&<span className="menu-week-set">{t('dailyMenu')} ✓</span>}<small>{lines.reduce((s,l)=>s+l.reserved,0)} {t('menuReserved').toLowerCase()}</small></button>;})}</div><label className="menu-date">{t('menuDate')}<input type="date" min={today()} max={addDays(today(),90)} value={date} disabled={busy} onChange={e=>{setDate(e.target.value);setSuccess('');}}/></label>{!loading&&date&&<MenuForm key={date+':'+(data.days.find(d=>d.date===date)?.revision??'new')} date={date} data={data} products={products} lang={lang} busy={busy} save={body=>save('save',body,'menuSaved')}/>}</div>;
}
/** A napi menü állandó ára (v49). */
function SetPriceForm({settings,lang,busy,save}:{settings:MenuData['settings'];lang:Language;busy:boolean;save:(body:unknown)=>Promise<void>}){
  const t=(k:string)=>messages[lang][k]??k;
  const [price,setPrice]=useState(()=>settings.setPrice?(settings.setPrice/100).toFixed(2):'');
  function submit(e:FormEvent){e.preventDefault();void save({revision:settings.revision,setPrice:Math.round(Number(price||0)*100)});}
  return <form className="panel menu-set-price" onSubmit={submit}><div><h2>{t('menuSetPrice')}</h2><p className="portal-hint">{t('menuSetPriceHint')}</p></div><label>{t('price')}<input type="number" min="0" max="100000" step="0.01" value={price} disabled={busy} onChange={e=>setPrice(e.target.value)}/></label><button className="button" disabled={busy}>{t('save')}</button></form>;
}
function MenuForm({date,data,products,lang,busy,save}:{date:string;data:MenuData;products:Product[];lang:Language;busy:boolean;save:(body:unknown)=>Promise<void>}){
  const t=(k:string)=>messages[lang][k]??k,day=data.days.find(d=>d.date===date);
  const [cutoff,setCutoff]=useState(()=>day?kitchenWallTime(new Date(day.cutoffAt)):date+'T09:00'),[active,setActive]=useState(day?.active??1),[items,setItems]=useState(()=>data.lines.filter(l=>l.date===date).map(l=>({productId:l.productId,capacity:l.capacity})));
  // A nap menüje (v49): leves, főétel, desszert a Napi menü részből.
  const [set,setSet]=useState<MenuSet>(()=>({soupId:day?.setSoupId??'',mainId:day?.setMainId??'',dessertId:day?.setDessertId??''}));
  const setKeys:[keyof MenuSet,(typeof DAILY_CATEGORIES)[number]][]=[['soupId','soup'],['mainId','main'],['dessertId','dessert']];
  function chooseSet(key:keyof MenuSet,id:string){
    setSet(s=>({...s,[key]:id}));
    // A menü ételének az étlapon is rajta kell lennie (az adagkorlát a menüre is érvényes).
    if(id&&!items.some(i=>i.productId===id))setItems(current=>[...current,{productId:id,capacity:0}]);
  }
  function submit(e:FormEvent){
    e.preventDefault();
    const chosen=setKeys.filter(([k])=>set[k]).length;
    void save({date,revision:day?.revision??null,cutoff,active,items,set:chosen===3?set:null});
  }
  const partial=setKeys.some(([k])=>set[k])&&!setKeys.every(([k])=>set[k]);
  return <form className="panel menu-editor" onSubmit={submit}><h2>{date}</h2><div className="menu-toolbar"><label>{t('menuCutoff')}<DateTime24 required max={date+'T23:59'} value={cutoff} disabled={busy} onChange={setCutoff} dateLabel={t('date')} timeLabel={t('time')}/></label><label><input type="checkbox" checked={!!active} disabled={busy} onChange={e=>setActive(e.target.checked?1:0)}/>{t('menuActive')}</label></div>
    <fieldset className="menu-set"><legend>{t('dailyMenu')}</legend><p className="portal-hint">{t('menuSetHint')}</p>{setKeys.map(([key,category])=><label key={key}>{t(category)}<select value={set[key]} disabled={busy} onChange={e=>chooseSet(key,e.target.value)}><option value="">—</option>{products.filter(p=>p.active&&(p.section??'alacarte')==='daily'&&p.category===category).map(p=><option key={p.id} value={p.id}>{p[lang]}</option>)}</select></label>)}{partial&&<p className="portal-alert">{t('menuSetIncomplete')}</p>}{!data.settings.setPrice&&<p className="portal-hint">{t('menuSetNoPrice')}</p>}</fieldset>
    <p className="portal-hint">{t('menuHint')}</p><p className="portal-hint">{t('menuPublishHint')}</p><div className="menu-table"><div className="menu-line menu-line-header"><span>{t('menuInclude')}</span><span>{t('menuCapacity')}</span><span>{t('menuReserved')}</span><span>{t('menuRemaining')}</span></div>{products.filter(p=>p.active||items.some(i=>i.productId===p.id)).map(p=>{const line=items.find(i=>i.productId===p.id),reserved=data.lines.find(l=>l.date===date&&l.productId===p.id)?.reserved??0,inSet=Object.values(set).includes(p.id);return <div className="menu-line" key={p.id}><label><input type="checkbox" checked={!!line} disabled={busy||reserved>0||inSet} onChange={e=>setItems(current=>e.target.checked?[...current,{productId:p.id,capacity:0}]:current.filter(i=>i.productId!==p.id))}/><span>{p[lang]}{inSet&&<small className="menu-set-badge">{t('dailyMenu')}</small>}</span></label><input aria-label={t('menuCapacity')+' · '+p[lang]} type="number" step="1" min={reserved} max={100000} disabled={busy||!line} required={!!line} value={line?.capacity??''} onChange={e=>setItems(current=>current.map(i=>i.productId===p.id?{...i,capacity:Number(e.target.value)}:i))}/><span>{reserved}</span><span>{line?Math.max(0,line.capacity-reserved):'—'}</span></div>;})}</div><button className="button" disabled={busy||!items.length||partial}>{t(busy?'saving':'menuSave')}</button></form>;
}
