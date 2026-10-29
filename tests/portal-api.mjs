import {ensureFulfillment} from "./fulfillment-fixture.mjs";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
const origin="http://127.0.0.1:5173",python=process.env.KITCHEN_TEST_PYTHON;assert.ok(python);
const cookie=(await fetch(origin+"/signin-with-chatgpt?return_to=/portal",{redirect:"manual"})).headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
async function call(path,body,status=200,anonymous=false){const r=await fetch(origin+"/api/"+path,{method:body?"POST":"GET",headers:{...(!anonymous?{Cookie:cookie}:{}),Origin:origin,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const fixture=role=>execFileSync(python,["tests/access-fixture.py",role],{stdio:"pipe"});
execFileSync(python,["tests/portal-fixture.py"],{stdio:"pipe"});
await call("portal/catalog",undefined,200,true);await call("portal/me",undefined,401,true);await call("portal/profile",{},401,true);
assert.equal((await fetch(origin+"/api/portal/profile",{method:"POST",headers:{Cookie:cookie,Origin:"https://example.invalid","Content-Type":"application/json"},body:"{}"})).status,403);
const product=await call("products",{hu:"LOCAL PORTAL DISH",ro:"LOCAL PORTAL DISH",descriptionHu:"Kitalált próbaétel",descriptionRo:"Preparat fictiv de test",category:"main",price:1234,portion:250,allergens:"milk"},201);
assert.ok(!(await call("portal/catalog",undefined,200,true)).some(p=>p.id===product.id));
await call("portal/catalog-setting",{productId:product.id,revision:0,visible:1});
const menu=await call("portal/catalog",undefined,200,true),published=menu.find(p=>p.id===product.id);assert.ok(published);assert.equal("portalRevision" in published,false);assert.equal("portalVisible" in published,false);
let me=await call("portal/me");
const details={name:"LOCAL PORTAL CUSTOMER",address:"Fictional local test address",phone:"0000000000"};
await call("portal/profile",{...details,customerId:"local_portal_other_customer"},400);
fixture("pending");
try{
await call("portal/profile",{...details,...(me.profile?{revision:me.profile.revision}:{})},me.profile?200:201);
await call("portal/profile",details);me=await call("portal/me");
}finally{fixture("restore");}
const date=new Date(new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Bucharest"}).format(new Date())+"T12:00:00Z");date.setUTCDate(date.getUTCDate()+1);
const fulfillment=await ensureFulfillment(call);
const input={...fulfillment,date:date.toISOString().slice(0,10),time:"12:00",note:"LOCAL PORTAL TEST",items:[{productId:product.id,quantity:2}]};
const menuState=await call("menu"),menuDay=menuState.days.find(d=>d.date===input.date);
await call("menu/save",{date:input.date,revision:menuDay?.revision??null,cutoff:input.date+"T09:00",active:1,items:[...menuState.lines.filter(l=>l.date===input.date&&l.productId!==product.id).map(l=>({productId:l.productId,capacity:l.capacity})),{productId:product.id,capacity:1000}]});
await call("portal/preview",{...input,userId:"local_portal_other"},400);await call("portal/preview",{...input,items:[{productId:product.id,quantity:2,price:1}]},400);
const oldPreview=await call("portal/preview",input);
await call("portal/profile",{...details,address:"Updated fictional address",revision:me.profile.revision});
await call("portal/profile",{...details,revision:me.profile.revision},409);
await call("portal/orders",{...input,id:randomUUID(),quote:oldPreview.quote},409);
const beforeHide=await call("portal/preview",input);await call("portal/catalog-setting",{productId:product.id,revision:1,visible:0});await call("portal/orders",{...input,id:randomUUID(),quote:beforeHide.quote},400);await call("portal/catalog-setting",{productId:product.id,revision:2,visible:1});
const preview=await call("portal/preview",input);assert.equal(preview.total,2468);assert.equal("recipeId" in preview.items[0],false);
const request={...input,id:randomUUID(),quote:preview.quote};
const responses=await Promise.all([200,201].map(async()=>{const r=await fetch(origin+"/api/portal/orders",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(request)});return {status:r.status,data:await r.json()};}));assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);assert.equal(responses[0].data.orderId,responses[1].data.orderId);
const id=responses[0].data.orderId;assert.equal((await call("portal/orders",request)).orderId,id);await call("portal/orders",{...request,note:"changed"},409);
me=await call("portal/me?userId=local_portal_other");assert.ok(me.orders.every(o=>o.id!=="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));assert.ok(!JSON.stringify(me).includes("OTHER PRIVATE"));
let mine=me.orders.find(o=>o.id===id);assert.equal(mine.status,"requested");assert.equal("portalUserId" in mine,false);assert.equal("customerId" in mine,false);assert.equal("recipeId" in mine.items[0],false);
await call("portal/cancel",{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",revision:0},404);
await call("orders/state",{id,revision:0,field:"production",value:"cooking"},400);assert.equal((await call("operations/issue",{orderId:id,revision:0,recipeIds:["fictional"],note:"",actual:[{ingredientId:"fictional",quantity:1}]},400)).error,"ISSUE_STATE");
try{fixture("pending");await call("data",undefined,403);assert.ok((await call("portal/me")).profile);await call("orders/state",{id,revision:0,field:"status",value:"confirmed"},403);}finally{fixture("restore");}
await call("orders/state",{id,revision:0,field:"status",value:"confirmed",note:"Local test confirmed"});
await call("portal/cancel",{id,revision:1},400);
me=await call("portal/me");mine=me.orders.find(o=>o.id===id);assert.equal(mine.status,"confirmed");assert.equal(mine.reviewNote,"Local test confirmed");
await call("portal/profile",{...details,address:"Third fictional address",revision:me.profile.revision});assert.equal((await call("portal/me")).orders.find(o=>o.id===id).address,"Updated fictional address");
async function submit(){const p=await call("portal/preview",input);return (await call("portal/orders",{...input,id:randomUUID(),quote:p.quote},201)).orderId;}
const rejected=await submit();await call("orders/state",{id:rejected,revision:0,field:"status",value:"rejected",note:" "},400);await call("orders/state",{id:rejected,revision:0,field:"status",value:"rejected",note:"Fictional test rejection"});assert.equal((await call("portal/me")).orders.find(o=>o.id===rejected).reviewNote,"Fictional test rejection");
const cancelled=await submit();await call("portal/cancel",{id:cancelled,revision:0});await call("portal/cancel",{id:cancelled,revision:0});
const raceId=await submit();
const race=await Promise.all([
  fetch(origin+"/api/orders/state",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({id:raceId,revision:0,field:"status",value:"confirmed",note:"Race test"})}),
  fetch(origin+"/api/portal/cancel",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({id:raceId,revision:0})}),
]);
assert.equal(race.filter(r=>r.status===200).length,1);assert.ok(race.every(r=>[200,400,409].includes(r.status)));
const raced=(await call("portal/me")).orders.find(o=>o.id===raceId);assert.equal(raced.revision,1);assert.ok(["confirmed","cancelled"].includes(raced.status));
let accounts=await call("portal/accounts"),own=accounts.find(a=>a.userId==="local_seedy");await call("portal/accounts/state",{userId:own.userId,revision:own.revision,active:0});await call("portal/me",undefined,403);await call("portal/preview",input,403);accounts=await call("portal/accounts");own=accounts.find(a=>a.userId==="local_seedy");await call("portal/accounts/state",{userId:own.userId,revision:own.revision,active:1});
const quotaPreview=await call("portal/preview",input);for(let i=0;i<10;i++)await call("portal/orders",{...input,id:randomUUID(),quote:quotaPreview.quote},201);await call("portal/orders",{...input,id:randomUUID(),quote:quotaPreview.quote},429);
me=await call("portal/me");for(const o of me.orders.filter(o=>o.status==="requested"))await call("portal/cancel",{id:o.id,revision:o.revision});
for(let i=0;i<6;i++)await call("portal/orders",{...input,id:randomUUID(),quote:quotaPreview.quote},201);await call("portal/orders",{...input,id:randomUUID(),quote:quotaPreview.quote},429);
try{fixture("disabled");await call("portal/me",undefined,403);fixture("kitchen");await call("portal/accounts",undefined,403);await call("portal/catalog-setting",{productId:product.id,revision:1,visible:0},403);fixture("dispatcher");await call("portal/accounts");await call("portal/accounts/state",{userId:"local_seedy",revision:0,active:0},403);}finally{fixture("restore");}
console.log("PASS portal: public whitelist, publication, profile ownership, stale preview, concurrent idempotency, cross-account isolation, request review, snapshots, cancellation, blocking, quotas and staff boundaries");
