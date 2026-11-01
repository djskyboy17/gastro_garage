"use client";
import { useState } from "react";
import { Truck, ArrowUpRight, Phone, MapPin, Store } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { total, type AppData, type Order, type Language } from "@/src/modules/shared/domain";
import { canAssign, deliveryList } from "@/src/modules/delivery/domain";
type Props = {data: AppData; lang: Language; busy: boolean; mutate: (path:string,body:unknown)=>Promise<boolean>};
/**
 * v51–v53: egyetlen futár van – nincs futártörzs, napi beosztás, futár szerinti szűrés és napi futárlista.
 * A nap kiszállításai időrendben, nagy, könnyen átlátható kártyákon (rendelésazonosító és futárnév nélkül).
 */
export default function DeliveryWorkspace({data,lang,day,onOrder}: Props & {day:string;onOrder:(o:Order)=>void}) {
  const t = (k:string) => messages[lang][k] ?? k;
  const rows = deliveryList(data.orders,day,"all");
  const money = (n:number) => new Intl.NumberFormat(lang === "hu" ? "hu-HU":"ro-RO",{style:"currency",currency:"RON"}).format(n/100);
  return <div className="logistics-workspace">
    <div className="delivery-grid delivery-simple">{rows.length ? rows.map((o,i)=><article className={"panel delivery-card is-clickable delivery-"+o.delivery} key={o.id} role="button" tabIndex={0} aria-label={t("open")+" · "+o.customerName} onClick={()=>onOrder(o)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOrder(o);}}}>
      <div className="delivery-card-top"><span className="stop-number">{i+1}.</span><strong className="delivery-time">{o.time}</strong><span className={"badge "+o.delivery}>{t(o.delivery)}</span></div>
      <h2>{o.customerName}</h2>
      <p className="delivery-line"><MapPin size={18} aria-hidden="true"/>{o.address}</p>
      {o.phone && <p className="delivery-line"><Phone size={18} aria-hidden="true"/>{o.phone}</p>}
      <div className="delivery-items">{o.items.map(item=><div key={item.id}><span>{item[lang]}</span><strong>×{item.quantity}</strong></div>)}</div>
      {o.note && <p className="delivery-order-note">{o.note}</p>}
      <div className="delivery-card-bottom"><span>{money(total(o))}<small>{t(o.payment)}</small></span><ArrowUpRight size={24} className="delivery-card-open" aria-hidden="true"/></div>
    </article>) : <div className="panel empty"><Truck size={30}/><h3>{t("noDelivery")}</h3></div>}</div>
  </div>;
}
/**
 * A rendelés kiszállítási része: kiszállítási előzmények, és (ha még nem indult el) átvételre váltás.
 * A futár nevét nem mutatja külön: egy futár van.
 */
export function OrderDeliveryEditor({data,lang,busy,mutate,order,canSwitch=false}: Props & {order:Order;canSwitch?:boolean}) {
  const t = (k:string) => messages[lang][k] ?? k;
  const [removeFee,setRemoveFee] = useState(false);
  const money = (n:number) => new Intl.NumberFormat(lang === "hu" ? "hu-HU":"ro-RO",{style:"currency",currency:"RON"}).format(n/100);
  const events = data.logistics.events.filter(e=>e.orderId===order.id);
  const switchable = canSwitch && canAssign(order);
  if (!events.length && !switchable) return null;
  return <section className="order-logistics">
    {switchable && <div className="packing-courier"><Store size={16}/><div>{(order.deliveryFee??0)>0&&<label className="packing-fee"><input type="checkbox" checked={removeFee} disabled={busy} onChange={e=>setRemoveFee(e.target.checked)}/>{t("packingRemoveFee")} ({money(order.deliveryFee??0)})</label>}</div><button type="button" className="button secondary" disabled={busy} onClick={()=>{if(window.confirm(t("packingToPickupConfirm")))void mutate("delivery/to-pickup",{id:order.id,revision:order.revision,removeFee});}}>{t("packingToPickup")}</button></div>}
    {events.length>0 && <details><summary>{t("deliveryHistory")} ({events.length})</summary>{events.map(e=>{
      let detail: {note?:string;from?:string;to?:string}={}; try{detail=JSON.parse(e.detail);}catch{}
      return <div className="delivery-event" key={e.id}><strong>{t(e.kind)}</strong><time>{new Date(e.createdAt).toLocaleString(lang==="hu"?"hu-HU":"ro-RO",{timeZone:"Europe/Bucharest"})}</time><p>{[detail.from,detail.to,detail.note].filter(Boolean).join(" · ")}</p></div>;
    })}</details>}
  </section>;
}
