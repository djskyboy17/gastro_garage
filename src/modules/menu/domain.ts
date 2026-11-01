export type MenuDay={date:string;cutoffAt:string;active:number;revision:number;setSoupId?:string|null;setMainId?:string|null;setDessertId?:string|null};
export type MenuLine={date:string;productId:string;capacity:number;reserved:number};
/** v49: a napi menü állandó ára (bani); 0 = a menü nem rendelhető. */
export type MenuSettings={setPrice:number;revision:number};
export type MenuData={days:MenuDay[];lines:MenuLine[];settings:MenuSettings};
/** A nap menüje (leves + főétel + desszert); vagy mindhárom, vagy egyik sem. */
export type MenuSet={soupId:string;mainId:string;dessertId:string};
export function validDay(v:string){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;}
export function addDays(v:string,n:number){const d=new Date(v+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function kitchenWallTime(now=new Date()){
  const p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=(key:string)=>p.find(v=>v.type===key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
// Reject nonexistent and ambiguous DST wall times instead of guessing an offset.
export function cutoffInstant(local:string):string|null{
  if(!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(local)||!validDay(local.slice(0,10)))return null;
  const nominal=Date.parse(local+'Z');
  const matches=[2,3].map(offset=>new Date(nominal-offset*3600000)).filter(d=>kitchenWallTime(d)===local);
  return matches.length===1?matches[0].toISOString():null;
}
export function remaining(capacity:number,reserved:number){return Math.max(0,capacity-reserved);}
/**
 * A napi menü ellenőrzése mentés előtt (v49): a leves, a főétel és a desszert aktív, a Napi menü részbe tartozó,
 * megfelelő kategóriájú étel, és mindhárom rajta van a nap étlapján (az adagkorlát így a menüre is érvényes).
 * Hibakódot ad vissza, vagy null-t, ha rendben van.
 */
export function menuSetError(set:MenuSet,products:{id:string;category:string;section?:string;active:number}[],lineIds:string[]):string|null{
  const want:[string,string][]=[[set.soupId,'soup'],[set.mainId,'main'],[set.dessertId,'dessert']];
  for(const [id,category] of want){
    const p=products.find(p=>p.id===id);
    if(!p||!p.active||p.category!==category||(p.section??'alacarte')!=='daily')return 'MENU_SET_PRODUCT';
    if(!lineIds.includes(id))return 'MENU_SET_NOT_ON_MENU';
  }
  return null;
}
