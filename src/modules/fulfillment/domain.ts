import {validDay,cutoffInstant,kitchenWallTime} from '../menu/domain.ts';
export type FulfillmentMode='delivery'|'pickup';
export type Zone={id:string;hu:string;ro:string;postcodes:string[];fee:number;minimum:number;active:boolean};
/** v50: a régi `capacity` (rendelések száma / nap) megszűnt; régi mentett szabályokban még szerepelhet, de nincs hatása. */
export type FulfillmentSlot={id:string;mode:FulfillmentMode;weekdays:number[];start:string;end:string;capacity?:number;active:boolean};
export type FulfillmentPolicy={deliveryEnabled:boolean;pickupEnabled:boolean;pickupHu:string;pickupRo:string;pickupMinimum:number;closedWeekdays:number[];closedDates:string[];zones:Zone[];slots:FulfillmentSlot[]};
export type PolicyData={revision:number|null;policy:FulfillmentPolicy;bookedSlotIds?:string[]};
export type FulfillmentSnapshot={mode:FulfillmentMode;slotId:string;start:string;end:string;weekdays:number[];zoneHu:string;zoneRo:string;postalCode:string;addressHu:string;addressRo:string;minimum:number;fee:number};
export const emptyPolicy:FulfillmentPolicy={deliveryEnabled:false,pickupEnabled:false,pickupHu:'',pickupRo:'',pickupMinimum:0,closedWeekdays:[],closedDates:[],zones:[],slots:[]};
export function isoWeekday(date:string){if(!validDay(date))throw Error('FULFILLMENT_DATE');return new Date(date+'T12:00:00Z').getUTCDay()||7;}
export function closedDay(p:FulfillmentPolicy,date:string){return p.closedDates.includes(date)||p.closedWeekdays.includes(isoWeekday(date));}
export function parseMoney(value:string){
  if(!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim()))throw Error('FULFILLMENT_MONEY');
  const [whole,fraction='']=value.trim().replace(',','.').split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(result>100000000)throw Error('FULFILLMENT_MONEY');return result;
}
export function validatePolicy(p:FulfillmentPolicy){
  if(p.pickupEnabled&&(!p.pickupHu.trim()||!p.pickupRo.trim()))throw Error('FULFILLMENT_ADDRESS');
  if(new Set(p.zones.map(z=>z.id)).size!==p.zones.length||new Set(p.slots.map(s=>s.id)).size!==p.slots.length)throw Error('VALIDATION');
  const codes=p.zones.filter(z=>z.active).flatMap(z=>z.postcodes);if(new Set(codes).size!==codes.length)throw Error('FULFILLMENT_ZONE_OVERLAP');
  for(const s of p.slots){
    if(s.start>=s.end||new Set(s.weekdays).size!==s.weekdays.length)throw Error('FULFILLMENT_SLOT');
    if(s.active&&p.slots.some(other=>other!==s&&other.active&&s.mode===other.mode&&s.weekdays.some(d=>other.weekdays.includes(d))&&s.start<other.end&&other.start<s.end))throw Error('FULFILLMENT_SLOT_OVERLAP');
  }
}
export function slotIdentity(s:Pick<FulfillmentSlot,'mode'|'weekdays'|'start'|'end'>){return JSON.stringify([s.mode,[...s.weekdays].sort(),s.start,s.end]);}
export function quoteFulfillment(p:FulfillmentPolicy,input:{mode:FulfillmentMode;slotId:string;postalCode:string;date:string;time:string},subtotal:number,now=new Date()):FulfillmentSnapshot{
  if(!validDay(input.date)||closedDay(p,input.date))throw Error('FULFILLMENT_CLOSED');
  if(!(input.mode==='pickup'?p.pickupEnabled:p.deliveryEnabled))throw Error('FULFILLMENT_DISABLED');
  const slot=p.slots.find(s=>s.id===input.slotId&&s.mode===input.mode&&s.active&&s.weekdays.includes(isoWeekday(input.date)));
  if(!slot||slot.start!==input.time||input.date+'T'+slot.start<=kitchenWallTime(now)||!cutoffInstant(input.date+'T'+slot.start)||!cutoffInstant(input.date+'T'+slot.end))throw Error('FULFILLMENT_SLOT');
  const zone=input.mode==='delivery'?p.zones.find(z=>z.active&&z.postcodes.includes(input.postalCode)):null;
  if(input.mode==='delivery'&&!zone)throw Error('FULFILLMENT_ZONE');
  if(input.mode==='pickup'&&input.postalCode!=='')throw Error('VALIDATION');
  const minimum=zone?.minimum??p.pickupMinimum;if(subtotal<minimum)throw Error('FULFILLMENT_MINIMUM');
  return {mode:input.mode,slotId:slot.id,start:slot.start,end:slot.end,weekdays:slot.weekdays,zoneHu:zone?.hu??'',zoneRo:zone?.ro??'',postalCode:input.postalCode,addressHu:input.mode==='pickup'?p.pickupHu:'',addressRo:input.mode==='pickup'?p.pickupRo:'',minimum,fee:zone?.fee??0};
}
export function orderFulfillment(order:{fulfillmentSnapshot?:string}):FulfillmentSnapshot|null{
  try{return order.fulfillmentSnapshot?JSON.parse(order.fulfillmentSnapshot) as FulfillmentSnapshot:null;}catch{return null;}
}
