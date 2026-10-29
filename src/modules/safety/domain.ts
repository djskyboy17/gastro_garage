export type SafetySnapshot = {hu:string;ro:string;area:string;kind:string;min:number|null;max:number|null;instructionsHu:string;instructionsRo:string};
export type SafetyPoint = SafetySnapshot & {id:string;active:number;revision:number;createdAt:string};
export type SafetyRecord = {id:string;pointId:string;snapshot:SafetySnapshot;temperature:number|null;answer:string|null;outcome:string;day:string;note:string;actor:string;actorName:string;createdAt:string;status:string;revision:number;correction:string;recheckId:string|null;resolvedBy:string;resolvedAt:string};
export type SafetyData = {points:SafetyPoint[];records:SafetyRecord[]};
export const emptySafety:SafetyData={points:[],records:[]};
// Store tenths of a degree as integers, including negative measurements.
export function parseTemperature(value:string):number {
  const normalized=value.trim().replace(",",".");
  if(!/^-?\d+(?:\.\d)?$/.test(normalized)) throw new Error("INVALID_TEMPERATURE");
  const negative=normalized.startsWith("-");
  const [whole,fraction="0"]=normalized.replace("-","").split(".");
  const n=(Number(whole)*10+Number(fraction))*(negative?-1:1);
  if(!Number.isSafeInteger(n)||n < -1000||n > 3000) throw new Error("INVALID_TEMPERATURE");
  return n;
}
export function safetyOutcome(point:SafetySnapshot,temperature:number|null,answer:string|null):"pass"|"fail" {
  if(point.kind==="temperature"){
    if(temperature===null||!Number.isSafeInteger(temperature)||temperature < -1000||temperature > 3000||answer!==null||point.min===null||point.max===null||point.min>point.max) throw new Error("INVALID_SAFETY_RESULT");
    return temperature>=point.min && temperature<=point.max?"pass":"fail";
  }
  if(point.kind!=="checklist"||temperature!==null||!["pass","fail"].includes(answer??"")) throw new Error("INVALID_SAFETY_RESULT");
  return answer as "pass"|"fail";
}
export function validRecheck(incident:SafetyRecord,check:SafetyRecord){
  return incident.id!==check.id && incident.pointId===check.pointId && check.createdAt>incident.createdAt && check.outcome==="pass" && safetyOutcome(incident.snapshot,check.temperature,check.answer)==="pass";
}
export function dailySafety(data:SafetyData,day:string){
  return data.points.filter(p=>p.active).map(point=>({point,latest:data.records.filter(r=>r.pointId===point.id && r.day===day).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0]}));
}
