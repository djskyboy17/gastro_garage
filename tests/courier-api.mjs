import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const origin='http://127.0.0.1:5173',python=process.env.KITCHEN_TEST_PYTHON;assert.ok(python);
const cookie=(await fetch(origin+'/signin-with-chatgpt?return_to=/courier',{redirect:'manual'})).headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
async function raw(path,body,anon=false){const r=await fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{...(!anon?{Cookie:cookie}:{}),Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function call(path,body,status=200,anon=false){const r=await raw(path,body,anon);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
const fixture=(...args)=>execFileSync(python,['tests/courier-fixture.py',...args],{stdio:'pipe'});
const A='c1111111-1111-4111-8111-111111111111',B='c2222222-2222-4222-8222-222222222222';
fixture('admin');
try{
for(const [id,name] of [[A,'Próba futár A'],[B,'Próba futár B']]){const response=await raw('delivery/couriers',{id,name,phone:'0000000000',vehicle:'Próba jármű',note:'LOCAL ONLY'});assert.ok([200,201].includes(response.status),JSON.stringify(response.data));}
// Membership approval and account binding use the real admin APIs.
let member=(await call('access/members')).find(m=>m.userId==='local_courier_target');await call('access/role',{userId:member.userId,revision:member.revision,role:'courier'});
let accounts=await call('courier/accounts'),a=accounts.couriers.find(c=>c.id===A),b=accounts.couriers.find(c=>c.id===B);
await call('courier/bind',{courierId:A,revision:a.bindingRevision,userId:'local_courier_target'});await call('courier/bind',{courierId:A,revision:a.bindingRevision,userId:null},409);await call('courier/bind',{courierId:B,revision:b.bindingRevision,userId:'local_courier_target'},409);
member=(await call('access/members')).find(m=>m.userId==='local_courier_target');await call('access/role',{userId:member.userId,revision:member.revision,role:'disabled'});accounts=await call('courier/accounts');assert.equal(accounts.couriers.find(c=>c.id===A).userId,null);
const customer=await call('customers',{name:'LOCAL ROUTE CUSTOMER',address:'Fictional Test Street 1',phone:'0000000000',note:''},201),other=await call('customers',{name:'OTHER PRIVATE COURIER CUSTOMER',address:'OTHER PRIVATE COURIER ADDRESS',phone:'1111111111',note:'PRIVATE'},201);
const product=await call('products',{hu:'Próba ebéd',ro:'Prânz de test',descriptionHu:'',descriptionRo:'',category:'main',price:1234,portion:250,allergens:'milk'},201),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest'}).format(new Date());
async function order(courierId,ready=true,customerId=customer.id,note='LOCAL COURIER TEST'){
 const id=randomUUID();await call('orders',{id,customerId,date:day,time:'12:00',note,items:[{productId:product.id,quantity:2}]},201);let revision=0;
 if(ready){await call('orders/state',{id,revision:0,field:'production',value:'cooking'});await call('orders/state',{id,revision:1,field:'production',value:'ready'});revision=2;const packed=(await call('data')).orders.find(o=>o.id===id);await call('packing/check',{id,revision,itemIds:packed.items.map(i=>i.id)});revision++;}
 await call('delivery/assign',{id,revision,courierId,note:'INTERNAL ASSIGNMENT NOTE'});return {id,revision:revision+1};
}
const ready=await order(A),queued=await order(A,false),privateOrder=await order(B,true,other.id),raceOrder=await order(A),browser=await order(A,true,customer.id,'LOCAL_COURIER_BROWSER');
fixture('driver');
await call('data',undefined,403);await call('access/members',undefined,403);await call('courier/accounts',undefined,403);await call('courier/bind',{courierId:A,revision:0,userId:null},403);await call('orders/state',{id:privateOrder.id,revision:privateOrder.revision,field:'delivery',value:'transit'},403);
const tasks=await call('courier/tasks?date='+day+'&courierId='+B+'&userId=local_courier_other');assert.ok(tasks.tasks.some(o=>o.id===ready.id));assert.ok(tasks.tasks.every(o=>o.id!==privateOrder.id));assert.ok(!JSON.stringify(tasks).includes('OTHER PRIVATE'));assert.ok(!JSON.stringify(tasks).includes('INTERNAL ASSIGNMENT NOTE'));
const task=tasks.tasks.find(o=>o.id===ready.id);for(const key of ['payment','deliveryFee','customerId','courierId','portalUserId','fulfillmentSnapshot'])assert.equal(key in task,false);assert.equal('price' in task.items[0],false);
const cmd=(o,value,note='')=>({requestId:randomUUID(),orderId:o.id,revision:o.revision,value,note});
await call('courier/state',cmd(privateOrder,'transit'),404);await call('courier/state',cmd(queued,'transit'),400);await call('courier/state',{...cmd(ready,'transit'),courierId:B},400);
const start=cmd(ready,'transit');const duplicated=await Promise.all([raw('courier/state',start),raw('courier/state',start)]);assert.ok(duplicated.every(r=>r.status===200),JSON.stringify(duplicated));await call('courier/state',start);await call('courier/state',{...start,note:'changed'},409);ready.revision++;
await call('courier/state',cmd(ready,'failed'),400);await call('courier/state',cmd(ready,'failed','Helyi próba: a címzett nem elérhető.'));ready.revision++;
await call('courier/state',cmd(ready,'transit'));ready.revision++;await call('courier/state',cmd(ready,'delivered','Helyi próba: átadva.'));ready.revision++;
const completed=(await call('courier/tasks?date='+day)).tasks.find(o=>o.id===ready.id);assert.equal(completed.delivery,'delivered');assert.equal(completed.events.filter(e=>e.kind==='transit').length,2);assert.ok(completed.events.some(e=>e.kind==='failed'&&e.note.includes('címzett')));
const competing=raw('courier/state',cmd(raceOrder,'transit'));fixture('reassign',raceOrder.id);const race=await competing;assert.ok([200,404,409].includes(race.status),JSON.stringify(race));const after=(await call('courier/tasks?date='+day)).tasks.find(o=>o.id===raceOrder.id);if(race.status!==200)assert.equal(after,undefined);
await call('courier/tasks?date=2026-02-30',undefined,400);await call('courier/tasks',undefined,401,true);
assert.equal((await fetch(origin+'/api/courier/state',{method:'POST',headers:{Cookie:cookie,Origin:'https://invalid.example','Content-Type':'application/json'},body:'{}'})).status,403);
fixture('disabled');await call('courier/tasks',undefined,403);await call('courier/state',cmd(browser,'transit'),403);
fixture('admin');accounts=await call('courier/accounts');assert.equal(accounts.couriers.find(c=>c.id===A).userId,null);const state=await call('data');assert.equal(state.orders.find(o=>o.id===ready.id).payment,'unpaid');assert.equal(state.logistics.events.filter(e=>e.id===start.requestId).length,1);
console.log('PASS courier: approved role/binding uniqueness, revocation unlink, own-only tasks/projection, generic staff denial, state guards, failure note, concurrent replay, assignment race, history, no payment access');
}finally{fixture('restore');}
