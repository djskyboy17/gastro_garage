import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
const origin="http://127.0.0.1:5173";
const python=process.env.KITCHEN_TEST_PYTHON;
assert.ok(python,"Set KITCHEN_TEST_PYTHON to local Python for local-only role fixtures");
const cookie=(await fetch(origin+"/signin-with-chatgpt?return_to=/",{redirect:"manual"})).headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
async function call(path,body,status=200,extra={}){
  const r=await fetch(origin+"/api/"+path,{method:body?"POST":"GET",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json",...extra},body:body?JSON.stringify(body):undefined});
  const raw=await r.text();let d;try{d=JSON.parse(raw);}catch{d={error:raw};}assert.equal(r.status,status,raw);return d;
}
const fixture=role=>execFileSync(python,["tests/access-fixture.py",role],{stdio:"pipe"});
assert.equal((await fetch(origin+"/api/data",{headers:{"oai-authenticated-user-id":"forged-owner","oai-authenticated-user-email":"forged@example.test"}})).status,401);
await call("access/request",{});assert.equal((await call("session")).role,"owner");
const data=await call("data"),id=randomUUID();
await call("orders",{id,customerId:data.customers[0].id,date:"2026-10-29",time:"15:00",note:"LOCAL ROLE TEST",items:[{productId:data.products[0].id,quantity:1}]},201);
try{
  for(const role of ["pending","disabled"]){fixture(role);await call("data",undefined,403);await call("access/members",undefined,403);await call("access/request",{role:"admin"});assert.equal((await call("session")).role,role);await call("orders",{},403);}
  fixture("kitchen");let d=await call("data");assert.deepEqual(d.customers,[]);assert.ok(d.orders.every(o=>!o.address&&!o.phone&&!o.payment&&!o.courierId&&o.items.every(i=>i.price===0)));assert.deepEqual(d.audit,[]);await call("orders/state",{id,revision:0,field:"production",value:"cooking"});await call("orders/state",{id,revision:1,field:"payment",value:"paid"},403);await call("access/role",{userId:"local_seedy",role:"admin",revision:0},403);await call("demo",{},403);
  fixture("warehouse");d=await call("data");assert.deepEqual(d.customers,[]);assert.equal(d.purchasing.suppliers.length,data.purchasing.suppliers.length);await call("operations/receive",{},400);await call("customers",{},403);await call("orders/state",{id,revision:1,field:"production",value:"ready"},403);
  fixture("dispatcher");d=await call("data");assert.equal(d.customers.length,data.customers.length);assert.deepEqual(d.operations.ingredients,[]);await call("operations/recipes",{},403);await call("access/members",undefined,403);await call("orders/state",{id,revision:1,field:"payment",value:"paid"});
  fixture("admin");await call("access/role",{userId:"local_seedy",revision:0,role:"disabled"},400);await call("access/role",{userId:"local_access_owner",revision:0,role:"disabled"},400);
  let members=await call("access/members"),target=members.find(m=>m.userId==="local_access_target");
  const request={userId:target.userId,revision:target.revision,role:"kitchen"};
  await call("access/role",request);await call("access/role",request,409);
  members=await call("access/members");assert.equal(members.find(m=>m.userId===target.userId).role,"kitchen");
  const logs=(await call("data")).audit.filter(a=>a.action==="role_changed"&&a.entity===target.userId);assert.equal(logs.length,1);
} finally {fixture("restore");}
assert.equal((await call("session")).role,"owner");
console.log("PASS access: header spoofing, pending/disabled, no self-escalation, live role enforcement, read projections, production/payment separation, owner/self protection and stale-update audit");
