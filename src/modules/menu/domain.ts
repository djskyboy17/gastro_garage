export type MenuDay={date:string;cutoffAt:string;active:number;revision:number};
export type MenuLine={date:string;productId:string;capacity:number;reserved:number};
export type MenuData={days:MenuDay[];lines:MenuLine[]};
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
