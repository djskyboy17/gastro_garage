import {orderFulfillment,type FulfillmentSnapshot} from "../fulfillment/domain.ts";
import type {Product,Order,Language} from "../shared/domain";
export type PublicProduct = Pick<Product,"id"|"hu"|"ro"|"descriptionHu"|"descriptionRo"|"category"|"price"|"portion"|"allergens">&{info?:import("../inventory/nutrition").PublicDishInfo|null};
export type PortalProfile={name:string;address:string;phone:string;revision:number};
export type PortalOrder=Pick<Order,"id"|"customerName"|"address"|"phone"|"date"|"time"|"note"|"status"|"production"|"delivery"|"payment"|"revision"|"createdAt"|"reviewNote">&{fulfillmentMode:string;deliveryFee:number;fulfillment:FulfillmentSnapshot|null;items:Pick<Order["items"][number],"id"|"hu"|"ro"|"allergens"|"price"|"quantity">[]};
export type PortalData={profile:PortalProfile|null;orders:PortalOrder[]};
export type PortalPreview={fulfillment:FulfillmentSnapshot;subtotal:number;quote:string;profile:PortalProfile;date:string;time:string;note:string;items:{productId:string;hu:string;ro:string;allergens:string;price:number;quantity:number}[];total:number};
export type PortalAccount={userId:string;customerId:string;name:string;address:string;phone:string;active:number;revision:number;createdAt:string};
export function publicProduct(p:Product):PublicProduct {
  const{id,hu,ro,descriptionHu,descriptionRo,category,price,portion,allergens}=p;
  return {id,hu,ro,descriptionHu,descriptionRo,category,price,portion,allergens};
}
export function publicOrder(o:Order):PortalOrder {
  const{id,customerName,address,phone,date,time,note,status,production,delivery,payment,revision,createdAt,reviewNote}=o;
  return {fulfillmentMode:o.fulfillmentMode??"delivery",deliveryFee:o.deliveryFee??0,fulfillment:orderFulfillment(o),id,customerName,address,phone,date,time,note,status,production,delivery,payment,revision,createdAt,reviewNote,items:o.items.map(({id,hu,ro,allergens,price,quantity})=>({id,hu,ro,allergens,price,quantity}))};
}
export function validPortalSlot(date:string,time:string,now=new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return false;
  const target=new Date(date+"T12:00:00Z");if(isNaN(target.getTime())||target.toISOString().slice(0,10)!==date)return false;
  const localDay=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Bucharest"}).format(now);
  const max=new Date(localDay+"T12:00:00Z");max.setUTCDate(max.getUTCDate()+30);
  const localTime=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Bucharest",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(now);
  return date>=localDay && date<=max.toISOString().slice(0,10) && (date!==localDay||time>localTime);
}
export function portalItemName(item:{hu:string;ro:string},lang:Language){return item[lang];}
