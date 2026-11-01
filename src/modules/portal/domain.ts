import {orderFulfillment,type FulfillmentSnapshot} from "../fulfillment/domain.ts";
import type {Product,Order,Language} from "../shared/domain";
export type PublicProduct = Pick<Product,"id"|"hu"|"ro"|"descriptionHu"|"descriptionRo"|"category"|"price"|"portion"|"allergens"|"hasImage"|"imageRevision">&{section:string;info?:import("../inventory/nutrition").PublicDishInfo|null};
export type PortalProfile={name:string;address:string;phone:string;revision:number};
export type PortalOrder=Pick<Order,"id"|"customerName"|"address"|"phone"|"date"|"time"|"note"|"status"|"production"|"delivery"|"payment"|"revision"|"createdAt"|"reviewNote">&{fulfillmentMode:string;deliveryFee:number;fulfillment:FulfillmentSnapshot|null;items:Pick<Order["items"][number],"id"|"hu"|"ro"|"allergens"|"price"|"quantity"|"setGroup">[]};
export type PortalData={profile:PortalProfile|null;orders:PortalOrder[]};
export type PortalPreview={fulfillment:FulfillmentSnapshot;subtotal:number;quote:string;profile:PortalProfile;date:string;time:string;note:string;items:{productId:string;hu:string;ro:string;allergens:string;price:number;quantity:number;setGroup:string}[];total:number};
export type PortalAccount={userId:string;customerId:string;name:string;address:string;phone:string;active:number;revision:number;createdAt:string};
export function publicProduct(p:Product):PublicProduct {
  const{id,hu,ro,descriptionHu,descriptionRo,category,price,portion,allergens,hasImage,imageRevision}=p;
  return {id,hu,ro,descriptionHu,descriptionRo,category,section:p.section??"alacarte",price,portion,allergens,hasImage:hasImage??0,imageRevision:imageRevision??0};
}
export function publicOrder(o:Order):PortalOrder {
  const{id,customerName,address,phone,date,time,note,status,production,delivery,payment,revision,createdAt,reviewNote}=o;
  return {fulfillmentMode:o.fulfillmentMode??"delivery",deliveryFee:o.deliveryFee??0,fulfillment:orderFulfillment(o),id,customerName,address,phone,date,time,note,status,production,delivery,payment,revision,createdAt,reviewNote,items:o.items.map(({id,hu,ro,allergens,price,quantity,setGroup})=>({id,hu,ro,allergens,price,quantity,setGroup:setGroup??""}))};
}
export function validPortalSlot(date:string,time:string,now=new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return false;
  const target=new Date(date+"T12:00:00Z");if(isNaN(target.getTime())||target.toISOString().slice(0,10)!==date)return false;
  const localDay=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Bucharest"}).format(now);
  // v50: a portálon csak mai napra lehet rendelni (Europe/Bucharest szerint), későbbi időpontra.
  const localTime=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Bucharest",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(now);
  return date===localDay && time>localTime;
}
export function portalItemName(item:{hu:string;ro:string},lang:Language){return item[lang];}
/** Az ügyfélnek mutatott lépéssor; a konyhai állapotokból számolódik (v19). */
export type ProgressStep={key:string;state:"done"|"current"|"todo"};
export type OrderProgress={steps:ProgressStep[];failed:boolean;closed:"rejected"|"cancelled"|null};
export function orderProgress(o:Pick<PortalOrder,"status"|"production"|"delivery"|"fulfillmentMode">):OrderProgress{
  if(o.status==="rejected"||o.status==="cancelled")return {steps:[],failed:false,closed:o.status};
  const pickup=o.fulfillmentMode==="pickup";
  const keys=["progressReceived","progressConfirmed","progressCooking","progressReady",pickup?"progressPickupReady":"progressTransit",pickup?"progressPickedUp":"progressDelivered"];
  // Az utolsó elért lépés indexe.
  let reached=0;
  if(o.status==="confirmed")reached=1;
  if(reached>=1&&o.production==="cooking")reached=2;
  if(reached>=1&&o.production==="ready")reached=pickup?4:3;
  if(!pickup&&(o.delivery==="transit"||o.delivery==="failed"))reached=4;
  if(o.delivery==="delivered")reached=5;
  const failed=!pickup&&o.delivery==="failed";
  return {failed,closed:null,steps:keys.map((key,i)=>({key,state:i<reached||(i===reached&&i===keys.length-1)?"done":i===reached?"current":"todo"}))};
}
