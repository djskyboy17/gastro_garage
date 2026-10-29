import type {Order} from '../shared/domain';
import {orderFulfillment} from '../fulfillment/domain.ts';
export type PackingOrder={id:string;customerName:string;date:string;time:string;windowEnd:string;mode:string;note:string;production:string;delivery:string;revision:number;courierAssigned:boolean;packingReady:number;packingCheckedAt:string;checkedItemIds:string[];items:{id:string;hu:string;ro:string;allergens:string;quantity:number}[]};
export type PackingData={date:string;orders:PackingOrder[]};
export function packingSelection(items:{id:string}[],selected:string[]){
 if(new Set(selected).size!==selected.length||selected.some(id=>!items.some(i=>i.id===id)))throw Error('PACKING_ITEMS');
 return {checkedItemIds:[...selected].sort(),ready:items.length>0&&selected.length===items.length};
}
export function packingOrder(o:Order):PackingOrder{
 let selected:string[]=[];try{const parsed=JSON.parse(o.packingItems??'[]');if(Array.isArray(parsed))selected=parsed.filter((id:unknown)=>typeof id==='string'&&o.items.some(i=>i.id===id));}catch{}
 return {id:o.id,customerName:o.customerName,date:o.date,time:o.time,windowEnd:orderFulfillment(o)?.end??'',mode:o.fulfillmentMode??'delivery',note:o.note,production:o.production,delivery:o.delivery,revision:o.revision,courierAssigned:!!o.courierId,packingReady:o.packingReady??0,packingCheckedAt:o.packingCheckedAt??'',checkedItemIds:selected,items:o.items.map(({id,hu,ro,allergens,quantity})=>({id,hu,ro,allergens,quantity}))};
}
export function workPlan(orders:PackingOrder[]){
 const result=new Map<string,{time:string;windowEnd:string;hu:string;ro:string;allergens:string;quantity:number;ready:number;packed:number}>();
 for(const o of orders)for(const i of o.items){const key=JSON.stringify([o.time,o.windowEnd,i.hu,i.ro,i.allergens]);const row=result.get(key)??{time:o.time,windowEnd:o.windowEnd,hu:i.hu,ro:i.ro,allergens:i.allergens,quantity:0,ready:0,packed:0};row.quantity+=i.quantity;if(o.production==='ready')row.ready+=i.quantity;if(o.packingReady===1)row.packed+=i.quantity;result.set(key,row);}
 return [...result.values()].sort((a,b)=>a.time.localeCompare(b.time)||a.hu.localeCompare(b.hu));
}
