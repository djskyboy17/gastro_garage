import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
const origin="http://127.0.0.1:5173";
const cookie=(await fetch(origin+"/signin-with-chatgpt?return_to=/",{redirect:"manual"})).headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
async function call(path,body,status=200){const r=await fetch(origin+"/api/"+path,{method:body?"POST":"GET",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const day=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Bucharest"}).format(new Date());
function later(n){const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
let data=await call("data");assert.ok(data.products.length>=2&&data.customers.length);
const p1=data.products[0],p2=data.products[1],customer=data.customers[0],id=randomUUID();
const template={id,name:"LOCAL RECURRING TEST "+id.slice(0,5),customerId:customer.id,start:day,end:later(40),time:"11:45",weekdays:[1,2,3,4,5,6,7],excludedDates:[later(2)],note:"Fictional local recurring test",items:[{productId:p1.id,quantity:2},{productId:p2.id,quantity:3}],active:1};
await call("recurring/templates",{...template,weekdays:[1,1]},400);await call("recurring/templates",{...template,items:[template.items[0],template.items[0]]},400);await call("recurring/templates",template,201);await call("recurring/templates",template);
await call("recurring/preview",{templateId:id,revision:0,from:later(-1),to:later(2)},400);await call("recurring/preview",{templateId:id,revision:0,from:day,to:later(31)},400);
const rangeA={templateId:id,revision:0,from:day,to:later(3)},rangeB={...rangeA,from:later(1),to:later(5)};
const a=await call("recurring/preview",rangeA),b=await call("recurring/preview",rangeB);assert.equal(a.days.length,3);assert.ok(!a.days.some(d=>d.date===later(2)));assert.equal(a.totalPerOrder,p1.price*2+p2.price*3);
const testPython=process.env.KITCHEN_TEST_PYTHON;assert.ok(testPython);
try{
  execFileSync(testPython,["tests/recurring-fixture.py",p1.id,String(p1.price+1)],{stdio:"pipe"});
  await call("recurring/generate",{...rangeA,id:randomUUID(),quote:a.quote},409);
  assert.notEqual((await call("recurring/preview",rangeA)).quote,a.quote);
}finally{execFileSync(testPython,["tests/recurring-fixture.py",p1.id,String(p1.price)],{stdio:"pipe"});}
const runA={...rangeA,id:randomUUID(),quote:a.quote},runB={...rangeB,id:randomUUID(),quote:b.quote};
const results=await Promise.all([call("recurring/generate",runA,201),call("recurring/generate",runB,201)]);assert.equal(results.reduce((s,r)=>s+r.created,0),5);
assert.deepEqual(await call("recurring/generate",runA),results[0]);await call("recurring/generate",{...runA,to:later(4)},409);
data=await call("data");let occurrences=data.recurring.occurrences.filter(o=>o.templateId===id);assert.equal(occurrences.length,5);
const first=data.orders.find(o=>o.id===occurrences.find(o=>o.day===day).orderId);assert.equal(first.items.length,2);assert.equal(first.items.find(i=>i.productId===p1.id).price,p1.price);assert.equal(first.address,customer.address);assert.equal(first.production,"queued");assert.equal(first.delivery,"pending");assert.equal(first.payment,"unpaid");
assert.equal(data.audit.filter(a=>a.action==="order_created"&&occurrences.some(o=>o.orderId===a.entity)).length,5);
const oldPreview=await call("recurring/preview",{...rangeA,to:later(6)});
const changed={...template,revision:0,items:[{productId:p1.id,quantity:9}]};await call("recurring/templates",changed);await call("recurring/templates",changed,409);
await call("recurring/generate",{...rangeA,to:later(6),id:randomUUID(),quote:oldPreview.quote},409);
assert.deepEqual(await call("recurring/generate",runA),results[0]);
const rangeC={templateId:id,revision:1,from:day,to:later(6)},c=await call("recurring/preview",rangeC);const resultC=await call("recurring/generate",{...rangeC,id:randomUUID(),quote:c.quote},201);assert.equal(resultC.created,1);assert.equal(resultC.skipped,5);
data=await call("data");const after=data.orders.find(o=>o.id===first.id);assert.deepEqual(after.items,first.items);
await call("orders/state",{id:first.id,revision:0,field:"status",value:"cancelled"});
const repeat=await call("recurring/preview",rangeC);const skipped=await call("recurring/generate",{...rangeC,id:randomUUID(),quote:repeat.quote},201);assert.equal(skipped.created,0);assert.equal(skipped.skipped,6);assert.equal((await call("data")).orders.find(o=>o.id===first.id).status,"cancelled");
await call("recurring/templates",{...changed,revision:1,active:0});await call("recurring/preview",{...rangeC,revision:2},400);
const full={...template,id:randomUUID(),excludedDates:[],items:[{productId:p1.id,quantity:1}]};await call("recurring/templates",full,201);const month={templateId:full.id,revision:0,from:day,to:later(30)},monthPreview=await call("recurring/preview",month);assert.equal(monthPreview.days.length,31);assert.equal((await call("recurring/generate",{...month,id:randomUUID(),quote:monthPreview.quote},201)).created,31);
const python=process.env.KITCHEN_TEST_PYTHON;assert.ok(python);const fixture=role=>execFileSync(python,["tests/access-fixture.py",role],{stdio:"pipe"});
try{fixture("kitchen");assert.deepEqual((await call("data")).recurring,{templates:[],occurrences:[]});await call("recurring/preview",month,403);fixture("warehouse");await call("recurring/templates",template,403);fixture("dispatcher");assert.ok((await call("data")).recurring.templates.length);await call("recurring/preview",month);}finally{fixture("restore");}
console.log("PASS recurring: validation, calendar exclusions, snapshots, overlapping concurrent generation, run replay, stale config, unchanged existing items, cancelled-day skip, pause, 31-day batch and roles");
