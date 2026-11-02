import {validDay,kitchenWallTime} from '../menu/domain.ts';
export type FulfillmentMode='delivery'|'pickup';
/** Szállítási körzet (v58): név szerint választható település; díj és minimum körzetenként (most 0, később beállítható). A régi `postcodes` mezőt a rendszer elhagyja. */
export type Zone={id:string;hu:string;ro:string;fee:number;minimum:number;active:boolean};
export type FulfillmentPolicy={deliveryEnabled:boolean;pickupEnabled:boolean;pickupHu:string;pickupRo:string;pickupMinimum:number;closedWeekdays:number[];closedDates:string[];zones:Zone[]};
export type PolicyData={revision:number|null;policy:FulfillmentPolicy};
/**
 * A rendelésbe mentett pillanatkép. v58 óta nincs idősáv: `start` a kívánt időpont (üres = minél előbb, `asap`), `end` üres.
 * A régi rendelések `slotId`/`end`/`weekdays`/`postalCode` értékei megmaradnak, ezért ezek a mezők is a típusban vannak.
 */
export type FulfillmentSnapshot={mode:FulfillmentMode;zoneId?:string;asap?:boolean;slotId:string;start:string;end:string;weekdays:number[];zoneHu:string;zoneRo:string;postalCode:string;addressHu:string;addressRo:string;minimum:number;fee:number};
export const emptyPolicy:FulfillmentPolicy={deliveryEnabled:false,pickupEnabled:false,pickupHu:'',pickupRo:'',pickupMinimum:0,closedWeekdays:[],closedDates:[],zones:[]};
/** Mentett (akár régi szerkezetű) szabály betöltése: a megszűnt idősávok és irányítószámok kimaradnak. */
export function normalizePolicy(raw:unknown):FulfillmentPolicy{
  const p={...emptyPolicy,...(raw as Partial<FulfillmentPolicy>)};
  return {deliveryEnabled:!!p.deliveryEnabled,pickupEnabled:!!p.pickupEnabled,pickupHu:p.pickupHu??'',pickupRo:p.pickupRo??'',pickupMinimum:p.pickupMinimum??0,closedWeekdays:p.closedWeekdays??[],closedDates:p.closedDates??[],zones:(p.zones??[]).map(z=>({id:z.id,hu:z.hu,ro:z.ro,fee:z.fee??0,minimum:z.minimum??0,active:!!z.active}))};
}
export function isoWeekday(date:string){if(!validDay(date))throw Error('FULFILLMENT_DATE');return new Date(date+'T12:00:00Z').getUTCDay()||7;}
export function closedDay(p:FulfillmentPolicy,date:string){return p.closedDates.includes(date)||p.closedWeekdays.includes(isoWeekday(date));}
export function parseMoney(value:string){
  if(!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim()))throw Error('FULFILLMENT_MONEY');
  const [whole,fraction='']=value.trim().replace(',','.').split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(result>100000000)throw Error('FULFILLMENT_MONEY');return result;
}
export function validatePolicy(p:FulfillmentPolicy){
  if(p.pickupEnabled&&(!p.pickupHu.trim()||!p.pickupRo.trim()))throw Error('FULFILLMENT_ADDRESS');
  if(new Set(p.zones.map(z=>z.id)).size!==p.zones.length)throw Error('VALIDATION');
  const names=p.zones.filter(z=>z.active).map(z=>z.hu.trim().toLowerCase());if(new Set(names).size!==names.length)throw Error('FULFILLMENT_ZONE_OVERLAP');
}
/**
 * Átvétel ellenőrzése és pillanatképe (v58): mód, körzet (kiszállításnál kötelező, átvételnél üres), kívánt időpont.
 * `time` üres = minél előbb; ha meg van adva, mai, még el nem múlt időpont kell (Europe/Bucharest).
 */
export function quoteFulfillment(p:FulfillmentPolicy,input:{mode:FulfillmentMode;zoneId:string;date:string;time:string},subtotal:number,now=new Date()):FulfillmentSnapshot{
  if(!validDay(input.date)||closedDay(p,input.date))throw Error('FULFILLMENT_CLOSED');
  if(!(input.mode==='pickup'?p.pickupEnabled:p.deliveryEnabled))throw Error('FULFILLMENT_DISABLED');
  if(input.time!==''&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)||input.date+'T'+input.time<=kitchenWallTime(now)))throw Error('FULFILLMENT_SLOT');
  const zone=input.mode==='delivery'?p.zones.find(z=>z.active&&z.id===input.zoneId):null;
  if(input.mode==='delivery'&&!zone)throw Error('FULFILLMENT_ZONE');
  if(input.mode==='pickup'&&input.zoneId!=='')throw Error('VALIDATION');
  const minimum=zone?.minimum??p.pickupMinimum;if(subtotal<minimum)throw Error('FULFILLMENT_MINIMUM');
  return {mode:input.mode,zoneId:zone?.id??'',asap:input.time==='',slotId:'',start:input.time,end:'',weekdays:[],zoneHu:zone?.hu??'',zoneRo:zone?.ro??'',postalCode:'',addressHu:input.mode==='pickup'?p.pickupHu:'',addressRo:input.mode==='pickup'?p.pickupRo:'',minimum,fee:zone?.fee??0};
}
export function orderFulfillment(order:{fulfillmentSnapshot?:string}):FulfillmentSnapshot|null{
  try{return order.fulfillmentSnapshot?JSON.parse(order.fulfillmentSnapshot) as FulfillmentSnapshot:null;}catch{return null;}
}
/** Időpont kiírása: régi idősávnál „11:00–12:00”, kívánt időpontnál „12:30”, különben üres (minél előbb). */
export function fulfillmentTime(s:Pick<FulfillmentSnapshot,'start'|'end'>){return s.start&&s.end?s.start+'–'+s.end:s.start;}
