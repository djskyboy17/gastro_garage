import type {Order} from '../shared/domain';
import {orderFulfillment} from '../fulfillment/domain.ts';
/**
 * v53: a csomagellenőrzés megszűnt; a Csomagolás menüben csak a termékcímkék maradtak. Ez a nap még el nem vitt
 * rendeléseinek rövid listája (a címkék rendelés szerinti szűréséhez).
 */
export type PackingOrder={id:string;customerName:string;date:string;time:string;windowEnd:string;mode:string;note:string;production:string;delivery:string;revision:number;items:{id:string;hu:string;ro:string;allergens:string;quantity:number}[]};
export type PackingData={date:string;orders:PackingOrder[]};
/** Csak az kerül a csomagolásba, amit még nem vittek el (futár úton, kézbesítve vagy átvéve: kimarad). */
export function needsPacking(o:Pick<Order,"delivery">){return o.delivery==="pending"||o.delivery==="failed";}
export function packingOrder(o:Order):PackingOrder{
 return {id:o.id,customerName:o.customerName,date:o.date,time:o.time,windowEnd:orderFulfillment(o)?.end??'',mode:o.fulfillmentMode??'delivery',note:o.note,production:o.production,delivery:o.delivery,revision:o.revision,items:o.items.map(({id,hu,ro,allergens,quantity})=>({id,hu,ro,allergens,quantity}))};
}
