import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
const origin="http://127.0.0.1:5173";
const cookie=(await fetch(origin+"/signin-with-chatgpt?return_to=/",{redirect:"manual"})).headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
async function call(path,body,status=200){const r=await fetch(origin+"/api/"+path,{method:body?"POST":"GET",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const state=async()=>await call("data");
const id=randomUUID(),point={id,hu:"LOCAL SAFETY TEST "+id.slice(0,5),ro:"LOCAL SAFETY TEST "+id.slice(0,5),area:"Local test only",kind:"temperature",min:0,max:50,instructionsHu:"Tesztadat; nem szakmai határérték",instructionsRo:"Date de test; nu reprezintă limite recomandate",active:1};
await call("safety/points",{...point,min:60},400);
await call("safety/points",point,201);await call("safety/points",point);
const input={id:randomUUID(),pointId:id,pointRevision:0,temperature:80,answer:null,note:""};
await call("safety/records",{...input,outcome:"pass"},400);
const incident={...input,note:"Fictional local deviation"};await call("safety/records",incident,201);await call("safety/records",incident);
await call("safety/records",{...incident,temperature:81},409);
let d=await state(),r=d.safety.records.find(r=>r.id===incident.id);assert.equal(r.status,"open");assert.equal(r.snapshot.max,50);assert.equal(r.outcome,"fail");
assert.equal(d.audit.filter(a=>a.entity===r.id&&a.action==="safety_recorded").length,1);
await call("safety/points",{...point,revision:0,max:100});
await call("safety/points",{...point,revision:0,max:100},409);
await call("safety/points",{...point,revision:1,kind:"checklist",min:null,max:null},400);
await call("safety/records",{...input,id:randomUUID(),note:"stale config"},409);
const relaxed={...input,id:randomUUID(),pointRevision:1,note:"",temperature:80};await call("safety/records",relaxed,201);
await call("safety/resolve",{id:r.id,revision:0,recheckId:relaxed.id,correction:"Fictional correction"},400);
await call("safety/resolve",{id:r.id,revision:0,recheckId:r.id,correction:"Fictional correction"},400);
const good={...relaxed,id:randomUUID(),temperature:40};await call("safety/records",good,201);
assert.equal((await state()).safety.records.find(x=>x.id===r.id).status,"open");
const resolve={id:r.id,revision:0,recheckId:good.id,correction:"Fictional local corrective action"};
await call("safety/resolve",{...resolve,correction:"   "},400);await call("safety/resolve",resolve);await call("safety/resolve",resolve);await call("safety/resolve",{...resolve,correction:"Changed action"},409);
d=await state();r=d.safety.records.find(x=>x.id===r.id);assert.equal(r.status,"resolved");assert.equal(r.snapshot.max,50);assert.equal(r.temperature,80);assert.equal(r.recheckId,good.id);assert.equal(d.audit.filter(a=>a.entity===r.id&&a.action==="safety_resolved").length,1);
await call("safety/points",{...point,revision:1,max:100,active:0});await call("safety/records",{...good,id:randomUUID(),pointRevision:2},400);
const checklist={...point,id:randomUUID(),kind:"checklist",min:null,max:null};await call("safety/points",checklist,201);await call("safety/records",{...good,id:randomUUID(),pointId:checklist.id,pointRevision:0,temperature:null,answer:"pass"},201);await call("safety/records",{...good,id:randomUUID(),pointId:checklist.id,pointRevision:0,answer:"pass"},400);
const python=process.env.KITCHEN_TEST_PYTHON;assert.ok(python);
const fixture=role=>execFileSync(python,["tests/access-fixture.py",role],{stdio:"pipe"});
try{
 fixture("dispatcher");assert.deepEqual((await state()).safety,{points:[],records:[]});await call("safety/records",good,403);
 fixture("kitchen");assert.ok((await state()).safety.points.length);await call("safety/points",point,403);await call("safety/resolve",resolve,403);await call("safety/records",{...good,id:randomUUID(),pointId:checklist.id,pointRevision:0,temperature:null,answer:"pass"},201);
 fixture("warehouse");await call("safety/resolve",resolve,403);
}finally{fixture("restore");}
console.log("PASS safety: threshold validation, server outcomes, snapshots, idempotency/audit, point revisions, original-limit recheck, manual closure, archive, checklist and role enforcement");
