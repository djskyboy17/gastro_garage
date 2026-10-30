"use client";
import { useState, type FormEvent } from "react";
import { Truck, Plus, Printer, ArrowUpRight } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { total, portions, type AppData, type Order, type Language } from "@/src/modules/shared/domain";
import { canAssign, deliveryList } from "@/src/modules/delivery/domain";
type Props = {data: AppData; lang: Language; busy: boolean; mutate: (path:string,body:unknown)=>Promise<boolean>};
export default function DeliveryWorkspace({data,lang,busy,mutate,day,onOrder}: Props & {day:string;onOrder:(o:Order)=>void}) {
  const t = (k:string) => messages[lang][k] ?? k;
  const [courier,setCourier] = useState("all"), [state,setState] = useState("open"), [showForm,setShowForm] = useState(false);
  const [requestId,setRequestId] = useState("");
  const rows = deliveryList(data.orders,day,courier,state);
  // Napi beosztás (v36): a csomagolásnál csak az aznap bejelölt futárok választhatók.
  const onShift = new Set((data.logistics.shifts ?? []).filter(s=>s.date===day).map(s=>s.courierId));
  const money = (n:number) => new Intl.NumberFormat(lang === "hu" ? "hu-HU":"ro-RO",{style:"currency",currency:"RON"}).format(n/100);
  async function create(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    if (await mutate("delivery/couriers",{id:requestId,name:f.get("name"),phone:f.get("phone"),vehicle:f.get("vehicle"),note:f.get("note")})) setShowForm(false);
  }
  return <div className="logistics-workspace">
    <section className="panel courier-panel">
      <div className="panel-heading"><div><h2>{t("couriers")}</h2><p>{t("courierHint")}</p></div><button className="button secondary" disabled={busy} onClick={()=>{setShowForm(!showForm);setRequestId(crypto.randomUUID());}}><Plus size={16}/>{t("newCourier")}</button></div>
      {showForm && <form className="courier-form" onSubmit={create}>
        <label>{t("courierName")}<input name="name" required maxLength={150}/></label>
        <label>{t("phone")}<input name="phone" type="tel" maxLength={40}/></label>
        <label>{t("vehicle")}<input name="vehicle" maxLength={100}/></label>
        <label>{t("note")}<input name="note" maxLength={500}/></label>
        <button className="button" disabled={busy} type="submit">{t(busy?"saving":"save")}</button>
      </form>}
      <p className="courier-shift-title"><strong>{t("courierShiftTitle")} · {day}</strong> {t("courierShiftHint")}</p>
      <div className="courier-roster">{data.logistics.couriers.length ? data.logistics.couriers.map(c=><div key={c.id} className={onShift.has(c.id)?"on-shift":""}><Truck size={16}/><strong>{c.name}</strong><span>{[c.vehicle,c.phone].filter(Boolean).join(" · ")}</span>{c.note && <small>{c.note}</small>}<label className="courier-shift-toggle"><input type="checkbox" checked={onShift.has(c.id)} disabled={busy} onChange={e=>void mutate("delivery/shift",{date:day,courierId:c.id,onShift:e.target.checked})}/>{t("courierOnShift")}</label></div>) : <p>{t("noCouriers")}</p>}</div>
    </section>
    <section className="panel manifest-toolbar">
      <div><h2>{t("manifest")}</h2><p>{t("manifestHint")}</p></div>
      <div className="manifest-filters">
        <label>{t("courierFilter")}<select value={courier} onChange={e=>setCourier(e.target.value)}><option value="all">{t("all")}</option><option value="unassigned">{t("unassigned")}</option>{data.logistics.couriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{t("deliveryFilter")}<select value={state} onChange={e=>setState(e.target.value)}>{["open","all","pending","transit","failed","delivered"].map(v=><option key={v} value={v}>{t(v==="open"?"openDeliveries":v)}</option>)}</select></label>
        <button className="button secondary" onClick={()=>window.print()}><Printer size={16}/>{t("manifestPrint")}</button>
      </div>
      <div className="manifest-summary"><strong>{day} · {courier==="all"?t("all"):courier==="unassigned"?t("unassigned"):data.logistics.couriers.find(c=>c.id===courier)?.name} · {t(state==="open"?"openDeliveries":state)}</strong><span>{rows.length} {t("stopCount")} · {rows.reduce((s,o)=>s+portions(o),0)} {t("units")} · {t("toCollect")}: {money(rows.filter(o=>o.payment==="unpaid").reduce((s,o)=>s+total(o),0))}</span></div>
    </section>
    <div className="delivery-grid">{rows.length ? rows.map((o,i)=><article className="panel delivery-card is-clickable" key={o.id} role="button" tabIndex={0} aria-label={t("open")+" · "+o.customerName} onClick={()=>onOrder(o)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOrder(o);}}}>
      <div className="delivery-card-top"><span className="stop-number">{String(i+1).padStart(2,"0")}</span><strong>{o.time}</strong><span className={"badge "+o.delivery}>{t(o.delivery)}</span></div>
      <h2>{o.customerName}</h2><p>{o.address}</p>{o.phone && <p>{t("phone")}: {o.phone}</p>}
      <p className="courier-assigned">{t("courier")}: <strong>{o.courierName || t("unassigned")}</strong></p>
      <div className="delivery-items">{o.items.map(item=><div key={item.id}><span>{item[lang]}</span><strong>×{item.quantity}</strong></div>)}</div>
      {o.note && <p className="delivery-order-note">{o.note}</p>}
      <small>#{o.id}</small>
      <div className="delivery-card-bottom"><span>{money(total(o))}<small>{t(o.payment)}</small></span><ArrowUpRight size={22} className="delivery-card-open" aria-hidden="true"/></div>
    </article>) : <div className="panel empty"><Truck size={30}/><h3>{t("noDelivery")}</h3></div>}</div>
  </div>;
}
export function OrderDeliveryEditor({data,lang,busy,mutate,order}: Props & {order:Order}) {
  const t = (k:string) => messages[lang][k] ?? k;
  const [courierId,setCourierId] = useState(order.courierId ?? ""), [note,setNote] = useState("");
  const events = data.logistics.events.filter(e=>e.orderId===order.id);
  return <section className="order-logistics">
    <h3>{t("assignment")}</h3><p>{order.courierName || t("unassigned")}{order.courierPhone?" · "+order.courierPhone:""}</p>
    {canAssign(order) ? <form onSubmit={async e=>{e.preventDefault();await mutate("delivery/assign",{id:order.id,revision:order.revision,courierId:courierId||null,note});}}>
      <label>{t("courier")}<select value={courierId} onChange={e=>setCourierId(e.target.value)} disabled={busy}><option value="">{t("unassigned")}</option>{data.logistics.couriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{t("assignmentNote")}<input maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button className="button secondary" disabled={busy || courierId===(order.courierId??"")}>{t("save")}</button>
    </form> : <p>{t("assignmentLocked")}</p>}
    {events.length>0 && <details><summary>{t("deliveryHistory")} ({events.length})</summary>{events.map(e=>{
      let detail: {note?:string;courier?:string;from?:string;to?:string}={}; try{detail=JSON.parse(e.detail);}catch{}
      return <div className="delivery-event" key={e.id}><strong>{t(e.kind)}</strong><time>{new Date(e.createdAt).toLocaleString(lang==="hu"?"hu-HU":"ro-RO",{timeZone:"Europe/Bucharest"})}</time><p>{[detail.from,detail.to,detail.courier,detail.note].filter(Boolean).join(" · ")}</p></div>;
    })}</details>}
  </section>;
}
