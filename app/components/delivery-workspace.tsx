"use client";
import { Truck, ArrowUpRight } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { total, type AppData, type Order, type Language } from "@/src/modules/shared/domain";
import { deliveryList } from "@/src/modules/delivery/domain";
type Props = {data: AppData; lang: Language; busy: boolean; mutate: (path:string,body:unknown)=>Promise<boolean>};
/**
 * v51: egyetlen futár van – nincs futártörzs, napi beosztás, futár szerinti szűrés és napi futárlista (nyomtatható
 * összesítő). Az oldal a nap kiszállításait mutatja időrendben, állapotjelzéssel; a futár a saját oldalán látja őket.
 */
export default function DeliveryWorkspace({data,lang,day,onOrder}: Props & {day:string;onOrder:(o:Order)=>void}) {
  const t = (k:string) => messages[lang][k] ?? k;
  const rows = deliveryList(data.orders,day,"all");
  const money = (n:number) => new Intl.NumberFormat(lang === "hu" ? "hu-HU":"ro-RO",{style:"currency",currency:"RON"}).format(n/100);
  return <div className="logistics-workspace">
    <div className="delivery-grid">{rows.length ? rows.map((o,i)=><article className="panel delivery-card is-clickable" key={o.id} role="button" tabIndex={0} aria-label={t("open")+" · "+o.customerName} onClick={()=>onOrder(o)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOrder(o);}}}>
      <div className="delivery-card-top"><span className="stop-number">{String(i+1).padStart(2,"0")}</span><strong>{o.time}</strong><span className={"badge "+o.delivery}>{t(o.delivery)}</span></div>
      <h2>{o.customerName}</h2><p>{o.address}</p>{o.phone && <p>{t("phone")}: {o.phone}</p>}
      {o.courierName && <p className="courier-assigned">{t("courier")}: <strong>{o.courierName}</strong></p>}
      <div className="delivery-items">{o.items.map(item=><div key={item.id}><span>{item[lang]}</span><strong>×{item.quantity}</strong></div>)}</div>
      {o.note && <p className="delivery-order-note">{o.note}</p>}
      <small>#{o.id}</small>
      <div className="delivery-card-bottom"><span>{money(total(o))}<small>{t(o.payment)}</small></span><ArrowUpRight size={22} className="delivery-card-open" aria-hidden="true"/></div>
    </article>) : <div className="panel empty"><Truck size={30}/><h3>{t("noDelivery")}</h3></div>}</div>
  </div>;
}
/** A rendelés kiszállítási előzményei (futár-hozzárendelés nélkül; a futár neve induláskor kerül a rendelésre). */
export function OrderDeliveryEditor({data,lang,order}: Props & {order:Order}) {
  const t = (k:string) => messages[lang][k] ?? k;
  const events = data.logistics.events.filter(e=>e.orderId===order.id);
  return <section className="order-logistics">
    {order.courierName && <><h3>{t("courier")}</h3><p>{order.courierName}</p></>}
    {events.length>0 && <details><summary>{t("deliveryHistory")} ({events.length})</summary>{events.map(e=>{
      let detail: {note?:string;courier?:string;from?:string;to?:string}={}; try{detail=JSON.parse(e.detail);}catch{}
      return <div className="delivery-event" key={e.id}><strong>{t(e.kind)}</strong><time>{new Date(e.createdAt).toLocaleString(lang==="hu"?"hu-HU":"ro-RO",{timeZone:"Europe/Bucharest"})}</time><p>{[detail.from,detail.to,detail.courier,detail.note].filter(Boolean).join(" · ")}</p></div>;
    })}</details>}
  </section>;
}
