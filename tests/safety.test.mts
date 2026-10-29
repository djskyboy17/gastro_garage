import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node test imports
import {parseTemperature,safetyOutcome,validRecheck,dailySafety,type SafetyRecord,type SafetyPoint} from "../src/modules/safety/domain.ts";
// @ts-ignore Native Node test imports
import {canWrite,projectData} from "../src/modules/access/domain.ts";
const point:SafetyPoint={id:"p",hu:"Teszt",ro:"Test",area:"Test",kind:"temperature",min:-50,max:50,instructionsHu:"",instructionsRo:"",active:1,revision:0,createdAt:"2026-10-29T00:00:00Z"};
const base:SafetyRecord={id:"r1",pointId:"p",snapshot:point,temperature:80,answer:null,outcome:"fail",day:"2026-10-29",note:"test",actor:"test",actorName:"Test",createdAt:"2026-10-29T10:00:00Z",status:"open",revision:0,correction:"",recheckId:null,resolvedAt:"",resolvedBy:""};
test("Signed decimal and comma temperatures are converted exactly to tenths",()=>{
  assert.equal(parseTemperature("-0,5"),-5);assert.equal(parseTemperature(" 4.2 "),42);assert.equal(parseTemperature("-18"),-180);
  for(const value of ["","NaN","1.25","4e2","--2","301","-101"])assert.throws(()=>parseTemperature(value),/INVALID_TEMPERATURE/);
});
test("Temperature limits are inclusive; checklist data cannot masquerade as a temperature",()=>{
  assert.equal(safetyOutcome(point,-50,null),"pass");assert.equal(safetyOutcome(point,50,null),"pass");assert.equal(safetyOutcome(point,51,null),"fail");assert.throws(()=>safetyOutcome(point,null,"pass"),/INVALID_SAFETY_RESULT/);
  const checklist={...point,kind:"checklist",min:null,max:null};assert.equal(safetyOutcome(checklist,null,"pass"),"pass");assert.equal(safetyOutcome(checklist,null,"fail"),"fail");assert.throws(()=>safetyOutcome(checklist,10,null));
});
test("Supervisor recheck must be later, same point and within original limits",()=>{
  const good={...base,id:"r2",outcome:"pass",temperature:40,createdAt:"2026-10-29T11:00:00Z"};
  assert.equal(validRecheck(base,good),true);assert.equal(validRecheck(base,{...good,pointId:"other"}),false);assert.equal(validRecheck(base,{...good,createdAt:base.createdAt}),false);assert.equal(validRecheck(base,{...good,outcome:"fail"}),false);assert.equal(validRecheck(base,{...good,temperature:80,snapshot:{...point,max:100}}),false);
});
test("Daily missing measurements stay missing, archived points leave daily list but history survives",()=>{
  const rows=dailySafety({points:[point,{...point,id:"other"},{...point,id:"archived",active:0}],records:[base]},base.day);assert.equal(rows.length,2);assert.equal(rows[0].latest?.outcome,"fail");assert.equal(rows[1].latest,undefined);assert.equal(dailySafety({points:[point],records:[base]},"2026-10-30")[0].latest,undefined);
});
test("Safety point/closure authority stays with supervisors; staff record results",()=>{
  for(const role of ["kitchen","warehouse"] as const){assert.equal(canWrite(role,"/api/safety/records",{}),true);assert.equal(canWrite(role,"/api/safety/points",{}),false);assert.equal(canWrite(role,"/api/safety/resolve",{}),false);}
  assert.equal(canWrite("dispatcher","/api/safety/records",{}),false);assert.equal(canWrite("admin","/api/safety/resolve",{}),true);
});
