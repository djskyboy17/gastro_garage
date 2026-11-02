"use client";
import {useCallback,useEffect,useState} from "react";
import {ShoppingBag,Plus,Minus,ArrowRight,CheckCircle2,RefreshCw,KeyRound,LogOut,Truck,MapPin,Soup,UserRound,X,Hamburger,BookOpen,PartyPopper,Phone,ArrowUpRight} from "lucide-react";
import {messages} from "@/src/modules/shared/i18n";
import {today,orderCode,groupSetItems,portionUnit,SET_CART_ID,type Language} from "@/src/modules/shared/domain";
import {isUnlimited,addDays} from "@/src/modules/menu/domain";
import {orderProgress,type PublicProduct,type PortalData,type PortalOrder,type PortalProfile,type PortalPreview} from "@/src/modules/portal/domain";
import {ProductImage} from "./product-image";
import {TimeInput24} from "./time-input";
import {fulfillmentTime} from "@/src/modules/fulfillment/domain";
type PublicFulfillment=import("@/src/modules/fulfillment/domain").PolicyData&{closed:boolean;orderUntilAt?:string|null;ordersClosed?:boolean};
type MenuProduct=PublicProduct&{remaining:number};
/** A nap menüje a portálon (v49, v54): leves + főétel egy áron. */
type MenuSetOffer={price:number;priceRevision:number;soup:MenuProduct;main:MenuProduct;remaining:number};
type WeekDay={date:string;set:MenuSetOffer|null;open:boolean};
const empty:PortalData={profile:null,orders:[]};
const CATEGORIES=["all","soup","main","vegetarian","dessert"];
// v60: a Kínálat kártyái és a rendezvénytípusok (szövegük a fordítási fájlban).
const OFFERS=[["gpOfferDaily",Soup],["gpOfferStreet",Hamburger],["gpOfferMenu",BookOpen],["gpOfferCatering",PartyPopper]] as const;
const EVENTS=["gpEventFamily","gpEventBirthday","gpEventBaptism","gpEventCompany","gpEventCommunity"];

/**
 * Ügyfélportál (v57): a gastrogarage.veres.no rendelési oldala a „Gastro Garage” arculattal (sötétzöld, mustársárga, krém).
 * A logika ugyanaz, mint korábban: mai napi menü és étlap, kosár, átvétel (zóna, idősáv), profil, ellenőrzés és küldés, saját rendelések.
 */
export default function ClientPortal(){
  const [lang,setLang]=useState<Language>("hu"),[catalog,setCatalog]=useState<MenuProduct[]>([]),[data,setData]=useState<PortalData>(empty),[authenticated,setAuthenticated]=useState(false),[blocked,setBlocked]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
  const [menuSet,setMenuSet]=useState<MenuSetOffer|null>(null);
  const [menuOpen,setMenuOpen]=useState(false),[cutoff,setCutoff]=useState<string|null>(null),[menuLoading,setMenuLoading]=useState(true);
  const [fulfillment,setFulfillment]=useState<PublicFulfillment|null>(null),[fulfillLoading,setFulfillLoading]=useState(true),[mode,setMode]=useState<"delivery"|"pickup">("delivery"),[zoneId,setZoneId]=useState(""),[asap,setAsap]=useState(true);
  const [cartLoaded,setCartLoaded]=useState(false),[sheetOpen,setSheetOpen]=useState(false),[editProfile,setEditProfile]=useState(false),[week,setWeek]=useState<WeekDay[]>([]);
  const [category,setCategory]=useState("all"),[cart,setCart]=useState<{productId:string;quantity:number}[]>([]),[time,setTime]=useState(""),[note,setNote]=useState(""),[preview,setPreview]=useState<PortalPreview|null>(null),[requestId,setRequestId]=useState("");
  // v50: csak mai napra lehet rendelni; a dátum nem választható.
  const date=today();
  const t=(key:string)=>messages[lang][key]??key;
  const locale=lang==="hu"?"hu-HU":"ro-RO";
  const money=(n:number)=>new Intl.NumberFormat(locale,{style:"currency",currency:"RON"}).format(n/100);
  // Nagy árkiírás: „28 lei” (fillér csak ha van).
  const lei=(n:number)=>(n%100?(n/100).toFixed(2).replace(".",","):String(n/100));
  const clock=(iso:string)=>new Intl.DateTimeFormat(locale,{timeZone:"Europe/Bucharest",hour:"2-digit",minute:"2-digit"}).format(new Date(iso));
  const dayName=(d:string,l:Language=lang)=>new Intl.DateTimeFormat(l==="hu"?"hu-HU":"ro-RO",{weekday:"long",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z"));
  const shortDate=(d:string)=>d.slice(8,10)+"."+d.slice(5,7);
  const fill=(s:string,v:Record<string,string>)=>s.replace(/\{(\w+)\}/g,(m,k:string)=>v[k]??m);
  useEffect(()=>{
    const l=localStorage.getItem("konyha-language");if(l==="hu"||l==="ro")setLang(l);
    try{const saved=JSON.parse(localStorage.getItem("konyha-portal-cart-v1")??"[]");if(Array.isArray(saved)&&saved.length<=10&&new Set(saved.map(i=>i.productId)).size===saved.length&&saved.every(i=>i&&typeof i.productId==="string"&&i.productId.length<=200&&Number.isInteger(i.quantity)&&i.quantity>=1&&i.quantity<=100))setCart(saved.map(i=>({productId:i.productId,quantity:i.quantity})));}catch{}
    try{const z=localStorage.getItem("konyha-portal-zone");if(z&&z.length<=100)setZoneId(z);}catch{}
    setCartLoaded(true);
  },[]);
  useEffect(()=>{if(cartLoaded)localStorage.setItem("konyha-portal-cart-v1",JSON.stringify(cart));},[cart,cartLoaded]);
  useEffect(()=>{if(cartLoaded&&zoneId)try{localStorage.setItem("konyha-portal-zone",zoneId);}catch{}},[zoneId,cartLoaded]);
  useEffect(()=>{document.documentElement.lang=lang;localStorage.setItem("konyha-language",lang);},[lang]);
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const me=await fetch("/api/portal/me",{cache:"no-store"});
      const personal=await me.json() as PortalData&{error?:string};
      if(me.status===401){setAuthenticated(false);setBlocked(false);setData(empty);}
      else if(me.status===403){setAuthenticated(true);setBlocked(true);setData(empty);setPreview(null);setError(personal.error??"PORTAL_BLOCKED");}
      else{if(!me.ok)throw new Error(personal.error??"loadError");setAuthenticated(true);setBlocked(false);setData(personal);}
    }catch(e){setData(empty);setPreview(null);setError(e instanceof Error?e.message:"loadError");}finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(!authenticated)return;
    const refresh=async()=>{
      if(document.visibilityState!=="visible")return;
      try{const r=await fetch("/api/portal/me",{cache:"no-store"});if(!r.ok)return;const d=await r.json() as PortalData;setData(prev=>({...prev,orders:d.orders}));}catch{}
    };
    const timer=setInterval(()=>void refresh(),30000);
    const onVisible=()=>{if(document.visibilityState==="visible")void refresh();};
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{clearInterval(timer);document.removeEventListener("visibilitychange",onVisible);};
  },[authenticated]);
  const [menuRefresh,setMenuRefresh]=useState(0);
  useEffect(()=>{let ignore=false;setMenuLoading(true);setMenuOpen(false);setCatalog([]);setMenuSet(null);setCutoff(null);setPreview(null);
    void (async()=>{try{const r=await fetch('/api/portal/menu?date='+encodeURIComponent(date),{cache:'no-store'}),d=await r.json() as {items:MenuProduct[];open:boolean;cutoffAt:string|null;set:MenuSetOffer|null;error?:string};if(!r.ok)throw Error(d.error??'loadError');if(!ignore){setCatalog(d.items);setMenuSet(d.set??null);setMenuOpen(d.open);setCutoff(d.cutoffAt);}}catch(e){if(!ignore)setError(e instanceof Error?e.message:'loadError');}finally{if(!ignore)setMenuLoading(false);}})();return ()=>{ignore=true;};
  },[date,menuRefresh]);
  useEffect(()=>{let ignore=false;setFulfillLoading(true);setFulfillment(null);setPreview(null);
    void (async()=>{try{const r=await fetch('/api/portal/fulfillment?date='+encodeURIComponent(date),{cache:'no-store'}),d=await r.json() as PublicFulfillment&{error?:string};if(!r.ok)throw Error(d.error??'loadError');if(!ignore){setFulfillment(d);if(!d.policy.deliveryEnabled&&d.policy.pickupEnabled)setMode('pickup');}}catch(e){if(!ignore)setError(e instanceof Error?e.message:'loadError');}finally{if(!ignore)setFulfillLoading(false);}})();return ()=>{ignore=true;};
  },[date,menuRefresh]);
  // Heti menü (v57): a hét hátralévő napjai (hétfő–szombat; vasárnap a következő hét). Elmúlt napra a portál nem ad menüt.
  useEffect(()=>{let ignore=false;
    const dow=new Date(date+"T12:00:00Z").getUTCDay();
    const monday=dow===0?addDays(date,1):addDays(date,1-dow);
    const days=[0,1,2,3,4,5].map(i=>addDays(monday,i)).filter(d=>d>=date);
    void Promise.all(days.map(async d=>{try{const r=await fetch('/api/portal/menu?date='+d,{cache:'no-store'});if(!r.ok)return {date:d,set:null,open:false};const m=await r.json() as {set:MenuSetOffer|null;open:boolean};return {date:d,set:m.set??null,open:m.open};}catch{return {date:d,set:null,open:false};}})).then(w=>{if(!ignore)setWeek(w);});
    return ()=>{ignore=true;};
  },[date,menuRefresh]);
  useEffect(()=>{if(success==="portalSent")document.getElementById("gp-orders")?.scrollIntoView({behavior:"smooth",block:"start"});},[success]);
  useEffect(()=>{if(!sheetOpen)return;const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")setSheetOpen(false);};document.addEventListener("keydown",onKey);return ()=>document.removeEventListener("keydown",onKey);},[sheetOpen]);
  async function post<T>(path:string,body:unknown):Promise<T>{const r=await fetch("/api/portal/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json() as T&{error?:string};if(!r.ok)throw new Error(d.error??"saveError");return d;}
  function quantity(productId:string,change:number){setPreview(null);setSuccess("");setCart(current=>{const old=current.find(i=>i.productId===productId);if(!old)return change>0&&current.length<10?[...current,{productId,quantity:1}]:current;return current.map(i=>i.productId===productId?{...i,quantity:Math.min(100,i.quantity+change)}:i).filter(i=>i.quantity>0);});}
  async function saveProfile(body:unknown){setBusy(true);setError("");setSuccess("");try{await post("profile",body);setPreview(null);await load();setMenuRefresh(n=>n+1);setEditProfile(false);setSuccess("updated");}catch(e){setError(e instanceof Error?e.message:"saveError");}finally{setBusy(false);}}
  async function check(){setBusy(true);setError("");setSuccess("");setPreview(null);try{setPreview(await post<PortalPreview>("preview",{mode,zoneId:mode==="pickup"?"":zoneId,date,time:asap?"":time,note,items:cart}));setRequestId(crypto.randomUUID());}catch(e){setError(e instanceof Error?e.message:"saveError");}finally{setBusy(false);}}
  async function send(){if(!preview)return;setBusy(true);setError("");try{await post("orders",{mode:preview.fulfillment.mode,zoneId:preview.fulfillment.zoneId??"",id:requestId,date:preview.date,time:preview.time,note:preview.note,items:groupSetItems(preview.items).map(l=>l.kind==="set"?{productId:SET_CART_ID,quantity:l.quantity}:{productId:l.item.productId,quantity:l.item.quantity}),quote:preview.quote});setPreview(null);setCart([]);setNote("");setSheetOpen(false);await load();setMenuRefresh(n=>n+1);setSuccess("portalSent");}catch(e){setError(e instanceof Error?e.message:"saveError");}finally{setBusy(false);}}
  async function cancel(id:string,revision:number){setBusy(true);setError("");try{await post("cancel",{id,revision});await load();setMenuRefresh(n=>n+1);setSuccess("updated");}catch(e){setError(e instanceof Error?e.message:"saveError");}finally{setBusy(false);}}
  const refreshAll=()=>{setError("");setPreview(null);void load();setMenuRefresh(n=>n+1);};
  const zones=fulfillment?.policy.zones.filter(z=>z.active)??[];
  const selectedZone=zones.find(z=>z.id===zoneId);
  const setProduct:MenuProduct|null=menuSet?{...menuSet.main,id:SET_CART_ID,hu:messages.hu.dailyMenu??"Napi menü",ro:messages.ro.dailyMenu??"Meniul zilei",price:menuSet.price,remaining:menuSet.remaining,hasImage:0}:null;
  const offers=setProduct?[setProduct,...catalog]:catalog;
  const dishes=catalog.filter(p=>p.section!=="daily"&&(category==="all"||p.category===category));
  const cartCount=cart.reduce((n,i)=>n+i.quantity,0);
  const total=cart.reduce((sum,i)=>sum+(offers.find(p=>p.id===i.productId)?.price??0)*i.quantity,0);
  // v61: a napi menü határideje és a szabályok rendelési határideje közül a korábbi számít.
  const deadline=[cutoff,fulfillment?.orderUntilAt].filter((v):v is string=>!!v).sort()[0]??null;
  const orderOpen=menuOpen&&!fulfillment?.ordersClosed;
  const canOrder=!busy&&!menuLoading&&orderOpen&&!blocked;
  const inCart=(id:string)=>cart.find(i=>i.productId===id)?.quantity??0;
  const canAdd=(id:string,remaining:number)=>remaining>inCart(id)&&inCart(id)<100&&(cart.length<10||inCart(id)>0);
  const until=deadline?fill(t("gpUntil"),{time:clock(deadline)}):"—";
  // A szalag szavai: a menüár (ha van ma napi menü, különben a hét első menüjéé), a kínálat és a rendezvények.
  const setPrice=menuSet?.price??week.find(d=>d.set)?.set?.price;
  const marquee=[...(setPrice?[fill(t("gpMarqueePrice"),{price:lei(setPrice)})]:[]),...t("gpMarqueeWords").split("|")];
  const allergenList=(a:string)=>a?a.split(",").filter(Boolean):[];
  // Mi hiányzik még a rendelés ellenőrzéséhez (a kosár ablakában jelezzük).
  const missing=!authenticated?"signin":blocked?"blocked":!data.profile?"profile":mode==="delivery"&&!selectedZone?"zone":!asap&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)?"slot":null;
  const stepper=(id:string,remaining:number,label:string,dark=false)=>inCart(id)>0
    ?<span className={"gp-stepper"+(dark?" dark":"")} role="group" aria-label={label}><button type="button" aria-label={t("portalDecrease")+" · "+label} disabled={busy} onClick={()=>quantity(id,-1)}><Minus size={18}/></button><output aria-live="polite">{inCart(id)}</output><button type="button" aria-label={t("portalIncrease")+" · "+label} disabled={!canOrder||!canAdd(id,remaining)} onClick={()=>quantity(id,1)}><Plus size={18}/></button></span>
    :<button type="button" className={"gp-add"+(dark?" dark":"")} disabled={!canOrder||!canAdd(id,remaining)} onClick={()=>quantity(id,1)}><Plus size={18}/>{t("portalAdd")}</button>;
  const availability=(remaining:number)=>remaining<=0?t("portalUnavailable"):isUnlimited(remaining)?t("portalAvailable"):t("menuRemaining")+": "+remaining;

  return <div className="gp">
    <header className="gp-top"><div className="gp-wrap">
      <a href="/portal" className="gp-brand"><img src="/logo.png" alt="" width={34} height={34}/>Gastro Garage</a>
      <nav aria-label={t("navigation")}><a href="#gp-order">{t("gpOrderCta")}</a>{authenticated&&!blocked&&<><a href="#gp-pick">{t("gpPickKicker")}</a><a href="#gp-orders">{t("portalOwn")}</a></>}<a href="#gp-week">{t("gpWeekCta")}</a><a href="#gp-catering">{t("gpOfferCatering")}</a></nav>
      <div className="gp-lang" role="group" aria-label={t("language")}>{(["hu","ro"] as const).map(l=><button key={l} type="button" aria-pressed={lang===l} onClick={()=>setLang(l)}>{l.toUpperCase()}</button>)}</div>
      {authenticated?<><a className="gp-icon" href="/password?return_to=/portal" aria-label={t("passwordChangeLink")} title={t("passwordChangeLink")}><KeyRound size={18}/></a><a className="gp-icon" href="/signout?return_to=/portal" aria-label={t("signOut")} title={t("signOut")}><LogOut size={18}/></a></>:<a className="gp-signin" href="/signin?return_to=/portal"><UserRound size={17}/>{t("signIn")}</a>}
    </div></header>

    <div className="gp-hero"><div className="gp-wrap">
      <div>
        <span className={"gp-pill"+(orderOpen?"":" closed")}><i/>{menuLoading||fulfillLoading?t("loading"):orderOpen&&deadline?fill(t("gpOpenUntil"),{time:clock(deadline)}):t("gpClosed")}</span>
        <h1>Gastro Garage</h1>
        <p className="gp-lead">{t("gpLead")}</p>
        <div className="gp-cta"><a className="gp-btn yellow" href="#gp-order">{t("gpOrderCta")}</a><a className="gp-btn ghost" href="#gp-week">{t("gpWeekCta")}<ArrowRight size={17}/></a></div>
        <a className="gp-phone" href={"tel:"+t("gpPhoneHref")}>{t("gpPhone")}</a>
      </div>
      <div className="gp-ticket">
        <div className="gp-ticket-head"><div><h2>{t("gpTodayMenu")}</h2><small>{dayName(date)} · {shortDate(date)}.{date.slice(0,4)}</small></div><span className="gp-badge"><Soup size={24}/></span></div>
        <div className="gp-dash"/>
        <div className="gp-ticket-row"><div><span>{t("gpPrice")}</span><strong>{menuSet?<>{lei(menuSet.price)}<em>lei</em></>:"—"}</strong></div><div><span>{t("gpOrderUntil")}</span><strong>{until}</strong></div></div>
        <div className="gp-dash"/>
        <p className="gp-ticket-foot"><Truck size={22}/><span>{menuSet?t("gpTicketFoot"):t("gpNoSetToday")}</span></p>
      </div>
    </div></div>

    {/* v64: két egyforma fél egymás után; a sáv a felénél ugrik vissza, így a körforgásnak nincs vége és hézaga. */}
    <div className="gp-marquee" aria-hidden="true"><div className="gp-marquee-track">{[0,1].map(half=><span key={half}>{Array.from({length:2},()=>marquee.map(w=>w+" • ").join("")).join("")}</span>)}</div></div>

    <main>
      {(error||success)&&<div className="gp-wrap gp-alerts">{error&&<div role="alert" className="gp-alert"><strong>{t(error)}</strong><button type="button" disabled={busy||loading} onClick={refreshAll}><RefreshCw size={15}/>{t("refresh")}</button></div>}{success&&<p role="status" className="gp-success"><CheckCircle2 size={18}/>{t(success)}</p>}</div>}

      <section id="gp-order" className="gp-section"><div className="gp-wrap">
        <p className="gp-kicker" data-n="01"><span/>{t("gpOrderCta")}</p>
        <h2 className="gp-title">{t("gpOrderTitle")}</h2>
        <p className="gp-sub">{t("gpOrderLead")}</p>
        {!menuLoading&&!fulfillLoading&&!orderOpen&&<p className="gp-note" role="status">{t(menuOpen?"gpClosed":"menuClosed")}</p>}
        <div className="gp-today">
          <div>{menuLoading?<p className="gp-note">{t("loading")}</p>:menuSet&&setProduct?<article className="gp-set">
            <div className="gp-set-head"><div><h3>{t("dailyMenu")}</h3><p>{dayName(date)} · {shortDate(date)}</p></div><span className="gp-tag">{t("gpToday")} · {until}</span></div>
            {([["soup",menuSet.soup],["main",menuSet.main]] as const).map(([c,p])=><div className="gp-course" key={c}><small>{t(c)}</small><strong>{p[lang]}</strong><p>{p[lang==="hu"?"ro":"hu"]} · {p.portion} {portionUnit(p.category)}</p>{allergenList(p.allergens).length>0&&<div className="gp-allergens" aria-label={t("allergens")}>{allergenList(p.allergens).map(a=><span key={a}>{t(a)}</span>)}</div>}</div>)}
            <div className="gp-set-buy"><div><div className="gp-price-big">{lei(menuSet.price)}<em>lei</em></div><p>{t("gpSetSub")} · {availability(menuSet.remaining)}</p></div>{stepper(SET_CART_ID,menuSet.remaining,t("dailyMenu"))}</div>
          </article>:<div className="gp-set gp-set-empty"><h3>{t("dailyMenu")}</h3><p>{t("gpNoSetToday")}</p></div>}</div>
          <div>
            <h3 className="gp-menu-title">{t("gpOfferMenu")}</h3>
            <div className="gp-chips" role="group" aria-label={t("category")}>{CATEGORIES.map(c=><button key={c} type="button" aria-pressed={category===c} onClick={()=>setCategory(c)}>{t(c)}</button>)}</div>
            {!menuLoading&&!dishes.length&&<p className="gp-note">{t("portalEmptyMenu")}</p>}
            <div className="gp-dishes">{dishes.map(p=><article className={"gp-dish"+(inCart(p.id)?" in-cart":"")} key={p.id}>
              <div className={"gp-dish-img "+p.category}><ProductImage product={p} alt={p[lang]} className="gp-photo"/>{p.hasImage!==1&&<span aria-hidden="true">{p[lang].charAt(0)}</span>}</div>
              <div><h3>{p[lang]}</h3><p className="gp-dish-alt">{p[lang==="hu"?"ro":"hu"]}</p><p className="gp-dish-meta">{p.portion} {portionUnit(p.category)} · {availability(p.remaining)}</p>
                {allergenList(p.allergens).length>0&&<div className="gp-allergens light" aria-label={t("allergens")}>{allergenList(p.allergens).map(a=><span key={a}>{t(a)}</span>)}</div>}
                <div className="gp-dish-buy"><strong>{lei(p.price)}<em>lei</em></strong>{stepper(p.id,p.remaining,p[lang],true)}</div></div>
            </article>)}</div>
          </div>
        </div>
      </div></section>

      <section id="gp-pick" className="gp-section gp-dark"><div className="gp-wrap">
        <p className="gp-kicker" data-n="02"><span/>{t("gpPickKicker")}</p>
        <h2 className="gp-title">{t("gpPickTitle")}</h2>
        <p className="gp-sub">{t("gpPickLead")}</p>
        <div className="gp-pick">
          <div className="gp-panel">
            <h3><span className="gp-badge round"><Truck size={19}/></span>{t("gpHow")}</h3>
            <div className="gp-seg" role="group" aria-label={t("fulfillMode")}>{(["delivery","pickup"] as const).map(m=><button key={m} type="button" aria-pressed={mode===m} disabled={busy||fulfillLoading||!(m==="delivery"?fulfillment?.policy.deliveryEnabled:fulfillment?.policy.pickupEnabled)} onClick={()=>{setMode(m);setPreview(null);}}>{t(m==="delivery"?"fulfillDelivery":"fulfillPickup")}</button>)}</div>
            {mode==="delivery"?<>
              <p className="gp-label">{t("gpZone")}</p>
              {zones.length?<div className="gp-zones">{zones.map(z=><button key={z.id} type="button" aria-pressed={selectedZone?.id===z.id} disabled={busy} onClick={()=>{setZoneId(z.id);setPreview(null);}}>{selectedZone?.id===z.id&&<MapPin size={16}/>}{z[lang]}</button>)}</div>:<p className="gp-hint">{t("gpNoZones")}</p>}
              {selectedZone&&<p className="gp-hint">{t("fulfillShipping")}: {selectedZone.fee?money(selectedZone.fee):t("gpFree")} · {t("fulfillMinimumFood")}: {money(selectedZone.minimum)}</p>}
            </>:fulfillment?.policy.pickupEnabled&&<p className="gp-hint">{t("fulfillPickupAt")}: {lang==="hu"?fulfillment.policy.pickupHu:fulfillment.policy.pickupRo} · {t("fulfillMinimumFood")}: {money(fulfillment.policy.pickupMinimum)}</p>}
            <p className="gp-label">{t("gpSlotToday")}</p>
            <div className="gp-slots"><button type="button" aria-pressed={asap} disabled={busy} onClick={()=>{setAsap(true);setPreview(null);}}>{t("gpAsap")}</button><button type="button" aria-pressed={!asap} disabled={busy} onClick={()=>{setAsap(false);setPreview(null);}}>{t("gpAtTime")}</button></div>
            {!asap&&<label className="gp-field"><span>{t("gpWantedTime")}</span><TimeInput24 required value={time} disabled={busy} onChange={v=>{setTime(v);setPreview(null);}}/></label>}
            <label className="gp-field"><span>{t("note")}</span><textarea maxLength={1500} value={note} disabled={busy} placeholder={t("gpNotePlaceholder")} onChange={e=>{setNote(e.target.value);setPreview(null);}}/></label>
          </div>
          <div className="gp-panel">
            <h3><span className="gp-badge round"><MapPin size={19}/></span>{t("gpYourData")}</h3>
            {!authenticated?<><p className="gp-hint">{t("gpSignInLead")}</p><a className="gp-btn yellow" href="/signin?return_to=/portal">{t("portalSignIn")}<ArrowRight size={17}/></a></>
              :blocked?<p className="gp-hint">{t("PORTAL_BLOCKED")}</p>
              :data.profile&&!editProfile?<div className="gp-profile"><strong>{data.profile.name}</strong><span>{data.profile.phone}</span><span>{data.profile.address||"—"}</span><button type="button" className="gp-btn ghost small" onClick={()=>setEditProfile(true)}>{t("gpEdit")}</button></div>
              :<><p className="gp-hint">{t("portalProfileHint")}</p><ProfileForm key={data.profile?.revision??"new"} profile={data.profile} t={t} busy={busy} save={saveProfile} cancel={data.profile?()=>setEditProfile(false):undefined}/></>}
            <p className="gp-hint">{t("portalPaymentHint")}</p>
          </div>
        </div>
      </div></section>

      {authenticated&&!blocked&&<section id="gp-orders" className="gp-section"><div className="gp-wrap">
        <p className="gp-kicker" data-n="03"><span/>{t("portalOwn")}</p>
        <div className="gp-title-row"><h2 className="gp-title">{t("gpOrdersTitle")}</h2><button type="button" className="gp-link" disabled={busy||loading} onClick={refreshAll}><RefreshCw size={15}/>{t("portalRefresh")}</button></div>
        <p className="gp-sub">{t("progressLive")}</p>
        {data.orders.length?<div className="gp-orders">{data.orders.map(o=>{const b=orderBars(o);const fee=o.deliveryFee??0;const sum=o.items.reduce((s,i)=>s+i.price*i.quantity,0)+fee;return <article className="gp-order" key={o.id}>
          <div className="gp-order-head"><div><h3>{o.date===date?t("gpToday"):o.date}, {o.fulfillment?fulfillmentTime(o.fulfillment)||t("gpAsap").toLowerCase():o.time}</h3><small>{t(o.fulfillmentMode==='pickup'?'fulfillPickup':'fulfillDelivery')} · {o.fulfillmentMode==='pickup'?(lang==="hu"?o.fulfillment?.addressHu:o.fulfillment?.addressRo):[o.address,o.fulfillment?.[lang==="hu"?"zoneHu":"zoneRo"]].filter(Boolean).join(", ")}</small></div><span className={"gp-state "+b.tone}><i/>{t(b.label)}</span></div>
          {b.steps.length>0&&<ol className="gp-bars" aria-label={t("progressTitle")}>{b.steps.map(s=><li key={s.key} className={s.state} aria-current={s.state==="current"?"step":undefined}>{t(s.key)}</li>)}</ol>}
          {b.failed&&<p className="gp-review">{t("progressFailed")}</p>}
          <div className="gp-order-lines">{groupSetItems(o.items).map(l=>l.kind==="set"?<div key="napi-menu"><span>{l.quantity} × {t("dailyMenu")}<small>{l.items.map(i=>i[lang]).join(" · ")}</small></span><b>{lei(l.total)} lei</b></div>:<div key={l.item.id}><span>{l.item.quantity} × {l.item[lang]}</span><b>{lei(l.item.price*l.item.quantity)} lei</b></div>)}
            {fee>0&&<div><span>{t("fulfillShipping")}</span><b>{lei(fee)} lei</b></div>}
            <div className="grand"><span>{t("gpTotal")}</span><b>{lei(sum)} lei</b></div></div>
          {o.note&&<p className="gp-hint">{o.note}</p>}{o.reviewNote&&<p className="gp-review">{o.reviewNote}</p>}
          <div className="gp-order-foot"><p className="gp-hint">{o.status==="requested"?t("gpCancelHint"):t("payment")+": "+t(o.payment)}</p><small>#{orderCode(o.id)}</small></div>
          {o.status==="requested"&&<button type="button" className="gp-btn outline small" disabled={busy} onClick={()=>{if(window.confirm(t("portalCancelConfirm")))void cancel(o.id,o.revision);}}>{t("portalCancel")}</button>}
        </article>;})}</div>:<p className="gp-note">{t("portalEmptyOrders")}</p>}
      </div></section>}

      <section id="gp-week" className="gp-section gp-paper"><div className="gp-wrap">
        <p className="gp-kicker" data-n={authenticated&&!blocked?"04":"03"}><span/>{t("gpWeekCta")}</p>
        <h2 className="gp-title">{t("gpWeekCta")}</h2>
        <p className="gp-sub">{t("gpWeekLead")}</p>
        <div className="gp-week">{week.map(d=><article key={d.date} className={"gp-day"+(d.date===date?" is-today":"")}>
          <div className="gp-day-head"><div><h3>{dayName(d.date)}</h3><p>{dayName(d.date,lang==="hu"?"ro":"hu")}</p></div>{d.date===date?<span className="gp-tag">{t("gpToday")}</span>:<span className="gp-day-date">{shortDate(d.date)}</span>}</div>
          {d.set?([["soup",d.set.soup],["main",d.set.main]] as const).map(([c,p])=><div className="gp-course" key={c}><small>{t(c)}</small><strong>{p[lang]}</strong><p>{p[lang==="hu"?"ro":"hu"]}</p></div>):<p className="gp-hint">{t("gpNoSet")}</p>}
        </article>)}</div>
      </div></section>

      <section id="gp-offer" className="gp-section gp-dark"><div className="gp-wrap">
        <p className="gp-kicker" data-n={authenticated&&!blocked?"05":"04"}><span/>{t("gpOfferKicker")}</p>
        <h2 className="gp-title">{t("gpOfferTitle")}</h2>
        <p className="gp-sub">{t("gpOfferLead")}</p>
        <div className="gp-offers">{OFFERS.map(([key,Icon],i)=><article className="gp-offer" key={key}><div className="gp-offer-top"><span className="gp-badge"><Icon size={26}/></span><span className="gp-offer-n">{String(i+1).padStart(2,"0")}</span></div><h3>{t(key)}</h3><p>{t(key+"Text")}</p></article>)}</div>
      </div></section>

      <section id="gp-catering" className="gp-section"><div className="gp-wrap gp-events-wrap">
        <div>
          <p className="gp-kicker" data-n={authenticated&&!blocked?"06":"05"}><span/>{t("gpEventsKicker")}</p>
          <h2 className="gp-title">{t("gpEventsTitle")}</h2>
          <p className="gp-sub">{t("gpEventsLead")}</p>
          <div className="gp-events-cta"><a className="gp-btn dark" href={"tel:"+t("gpPhoneHref")}><Phone size={18}/>{t("gpEventsCall")}</a><a className="gp-btn outline" href={"mailto:"+t("gpEmail")}>{t("gpEventsMail")}<ArrowUpRight size={17}/></a></div>
        </div>
        <ol className="gp-events">{EVENTS.map((key,i)=><li key={key}><small>{String(i+1).padStart(2,"0")}</small><strong>{t(key)}</strong></li>)}</ol>
      </div></section>

      <section className="gp-section"><div className="gp-wrap">
        <p className="gp-kicker" data-n={authenticated&&!blocked?"07":"06"}><span/>{t("gpFaqKicker")}</p>
        <h2 className="gp-title">{t("gpFaqTitle")}</h2>
        <div className="gp-faq">
          <details open><summary>{t("gpFaqPriceQ")}</summary><p>{menuSet?fill(t("gpFaqPriceA"),{price:money(menuSet.price)}):t("gpNoSetToday")}</p></details>
          <details><summary>{t("gpFaqCutoffQ")}</summary><p>{fill(t("gpFaqCutoffA"),{until,phone:t("gpPhone")})}</p></details>
          <details><summary>{t("gpFaqZonesQ")}</summary><p>{fulfillment?.policy.deliveryEnabled&&zones.length?zones.map(z=>z[lang]+" ("+(z.fee?money(z.fee):t("gpFree"))+")").join(", "):t("gpNoZones")}</p></details>
          <details><summary>{t("gpFaqCancelQ")}</summary><p>{t("gpCancelHint")}</p></details>
        </div>
      </div></section>
    </main>

    <footer className="gp-footer"><div className="gp-wrap">
      <h2>Gastro Garage</h2><p>{t("gpLead")}</p>
      <div className="gp-cols">
        <div><h4>{t("gpContact")}</h4><a className="big" href={"tel:"+t("gpPhoneHref")}>{t("gpPhone")}</a><a href={"mailto:"+t("gpEmail")}>{t("gpEmail")}</a><p>{t("gpAddress")}</p></div>
        <div><h4>{t("gpPage")}</h4><a href="#gp-order">{t("gpOrderCta")}</a><a href="#gp-week">{t("gpWeekCta")}</a>{authenticated&&!blocked&&<a href="#gp-orders">{t("portalOwn")}</a>}<a href="#gp-offer">{t("gpOfferKicker")}</a><a href="#gp-catering">{t("gpOfferCatering")}</a><a href="/">{t("portalInternal")}</a></div>
      </div>
      <p className="gp-copy">© {date.slice(0,4)} Gastro Garage · {t("settingsNote")}</p>
    </div></footer>

    {cartCount>0&&!sheetOpen&&<div className="gp-cartbar"><span className="gp-count">{cartCount}</span><div className="gp-sum">{lei(total)} lei<small>{t("portalCart")}</small></div><button type="button" className="gp-btn dark" onClick={()=>setSheetOpen(true)}>{t("gpNext")}<ArrowRight size={17}/></button></div>}
    {sheetOpen&&<><div className="gp-sheet-bg" onClick={()=>setSheetOpen(false)}/>
      <div className="gp-sheet" role="dialog" aria-modal="true" aria-labelledby="gp-sheet-title">
        <div className="gp-sheet-head"><h2 id="gp-sheet-title"><ShoppingBag size={22}/>{t("gpYourOrder")}</h2><button type="button" className="gp-close" aria-label={t("close")} onClick={()=>setSheetOpen(false)}><X size={20}/></button></div>
        {cart.length?cart.map(i=>{const p=offers.find(p=>p.id===i.productId);const label=p?.[lang]??t("portalUnavailable");return <div className="gp-line" key={i.productId}><div><b>{label}</b><small>{i.productId===SET_CART_ID&&menuSet?menuSet.soup[lang]+" + "+menuSet.main[lang]+" · ":""}{p?money(p.price):"—"}</small></div>
          <span className="gp-stepper dark small"><button type="button" aria-label={t("portalDecrease")+" · "+label} disabled={busy} onClick={()=>quantity(i.productId,-1)}><Minus size={16}/></button><output>{i.quantity}</output><button type="button" aria-label={t("portalIncrease")+" · "+label} disabled={!canOrder||!p||i.quantity>=p.remaining||i.quantity>=100} onClick={()=>quantity(i.productId,1)}><Plus size={16}/></button></span></div>;}):<p className="gp-hint">{t("portalEmptyCart")}</p>}
        {error&&<div role="alert" className="gp-alert"><strong>{t(error)}</strong></div>}
        {preview?<>
          <div className="gp-preview"><strong>{preview.profile.name}</strong><span>{preview.fulfillment.mode==='pickup'?(lang==='hu'?preview.fulfillment.addressHu:preview.fulfillment.addressRo):preview.profile.address} · {preview.profile.phone}</span><span>{t(preview.fulfillment.mode==='pickup'?'fulfillPickup':'fulfillDelivery')}{preview.fulfillment.zoneHu?" · "+(lang==="hu"?preview.fulfillment.zoneHu:preview.fulfillment.zoneRo):""} · {t("gpToday")} {fulfillmentTime(preview.fulfillment)||t("gpAsap").toLowerCase()}</span>{preview.note&&<span>{preview.note}</span>}</div>
          <div className="gp-totals"><div><span>{t("fulfillFoodTotal")}</span><span>{money(preview.subtotal)}</span></div><div><span>{t("fulfillShipping")}</span><span>{preview.fulfillment.fee?money(preview.fulfillment.fee):t("gpFree")}</span></div><div className="grand"><span>{t("fulfillGrandTotal")}</span><span>{money(preview.total)}</span></div></div>
          <button type="button" className="gp-btn yellow wide" disabled={busy} onClick={()=>void send()}>{t(busy?"saving":"portalSend")}<ArrowRight size={17}/></button>
        </>:<>
          <div className="gp-totals"><div className="grand"><span>{t("fulfillFoodTotal")}</span><span>{money(total)}</span></div></div>
          {missing==="signin"?<a className="gp-btn yellow wide" href="/signin?return_to=/portal">{t("portalSignIn")}<ArrowRight size={17}/></a>
            :missing==="blocked"?<p className="gp-hint">{t("PORTAL_BLOCKED")}</p>
            :missing?<><p className="gp-hint">{t(missing==="profile"?"portalProfileFirst":missing==="zone"?"gpNeedZone":"gpNeedSlot")}</p><a className="gp-btn dark wide" href="#gp-pick" onClick={()=>setSheetOpen(false)}>{t("gpPickKicker")}<ArrowRight size={17}/></a></>
            :<button type="button" className="gp-btn yellow wide" disabled={busy||loading||menuLoading||fulfillLoading||!orderOpen||!cart.length} onClick={()=>void check()}>{t(busy?"loading":"portalPreview")}<ArrowRight size={17}/></button>}
        </>}
        <p className="gp-hint center">{t("portalSlotHint")}</p>
      </div></>}
  </div>;
}
/**
 * A rendelés állapota négy sávban (v59, a minta szerint): beérkezett → visszaigazolva → készül → úton / átvehető.
 * Az „elkészült” a Készül sávon marad (címke: Elkészült); kézbesítéskor / átvételkor mind a négy kész.
 */
function orderBars(o:PortalOrder){
  const p=orderProgress(o);
  if(p.closed)return {steps:[] as {key:string;state:string}[],failed:false,label:p.closed,tone:"closed"};
  const all=p.steps,current=all.findIndex(s=>s.state==="current"),reached=current<0?all.length:current;
  const index=reached<=1?reached:reached<=3?2:reached===4?3:4;
  const keys=[all[0]!.key,all[1]!.key,all[2]!.key,all[4]!.key];
  const steps=keys.map((key,i)=>({key,state:i<index?"done":i===index?"current":"todo"}));
  const label=o.status==="requested"?"requested":index>=4?all[5]!.key:reached===3?all[3]!.key:keys[index]!;
  return {steps,failed:p.failed,label,tone:o.status==="requested"?"requested":index>=4?"done":"active"};
}
function ProfileForm({profile,t,busy,save,cancel}:{profile:PortalProfile|null;t:(k:string)=>string;busy:boolean;save:(body:unknown)=>Promise<void>;cancel?:()=>void}){
  return <form className="gp-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({...(profile?{revision:profile.revision}:{}),name:f.get("name"),address:f.get("address"),phone:f.get("phone")});}}>
    <label className="gp-field"><span>{t("name")}</span><input name="name" autoComplete="name" required maxLength={200} defaultValue={profile?.name}/></label>
    <label className="gp-field"><span>{t("phone")}</span><input name="phone" autoComplete="tel" type="tel" required minLength={6} maxLength={40} defaultValue={profile?.phone}/></label>
    <label className="gp-field"><span>{t("fulfillAddress")}</span><input name="address" autoComplete="street-address" minLength={5} maxLength={500} defaultValue={profile?.address}/></label>
    <div className="gp-form-actions"><button className="gp-btn yellow" disabled={busy}>{t(busy?"saving":"portalSaveProfile")}</button>{cancel&&<button type="button" className="gp-btn ghost" onClick={cancel}>{t("cancel")}</button>}</div>
  </form>;
}
