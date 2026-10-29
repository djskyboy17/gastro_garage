import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const origin='http://127.0.0.1:5173',python=process.env.KITCHEN_TEST_PYTHON;assert.ok(python);
const cookie=(await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'})).headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
const fixture=(file,...args)=>execFileSync(python,['tests/'+file,...args],{stdio:'pipe'});
async function raw(path,body,extra={}){const r=await fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:text};}return {status:r.status,data};}
async function call(path,body,status=200,extra={}){const r=await raw(path,body,extra);assert.equal(r.status,status,path+': '+JSON.stringify(r.data));return r.data;}
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest'}).format(new Date()),A='c1111111-1111-4111-8111-111111111111';
fixture('courier-fixture.py','admin');
try{
 const key=randomUUID().slice(0,6),customer=await call('customers',{name:'Csomagolási próba '+key,address:'PRIVATE TEST ADDRESS',phone:'0000000000',note:''},201);
 const products=[];for(const [hu,ro,allergens] of [['Próbaleves','Supă de test','milk'],['Próbafőétel','Fel principal de test','gluten']])products.push(await call('products',{hu:hu+' '+key,ro:ro+' '+key,descriptionHu:'Kitalált próbaétel',descriptionRo:'Preparat fictiv de test',category:'main',price:1500,portion:300,allergens},201));
 async function create(note,ready=true){const id=randomUUID();await call('orders',{id,customerId:customer.id,date:day,time:'12:30',note,items:products.map(p=>({productId:p.id,quantity:3}))},201);if(ready){await call('orders/state',{id,revision:0,field:'production',value:'cooking'});await call('orders/state',{id,revision:1,field:'production',value:'ready'});}return id;}
 const id=await create('LOCAL PACKING API'),queuedId=await create('LOCAL PACKING QUEUED',false),cancelId=await create('LOCAL PACKING CANCELLED',false);await call('orders/state',{id:cancelId,revision:0,field:'status',value:'cancelled'});
 let o;const reload=async()=>{o=(await call('packing?date='+day)).orders.find(o=>o.id===id);return o;};await reload();
 assert.equal(o.items.length,2);assert.equal(o.packingReady,0);assert.ok(!(await call('packing?date='+day)).orders.some(o=>o.id===cancelId));
 for(const field of ['price','payment','address','phone','customerId'])assert.equal(field in o,false);assert.equal('price' in o.items[0],false);
 await call('packing?date=2026-02-30',undefined,400);await call('packing/check',{id:queuedId,revision:0,itemIds:[]},400);await call('packing/check',{id,revision:o.revision,itemIds:['foreign']},400);await call('packing/check',{id,revision:o.revision,itemIds:[o.items[0].id,o.items[0].id]},400);await call('packing/check',{id,revision:o.revision,itemIds:[],packingReady:1},400);
 await call('packing/check',{id,revision:o.revision,itemIds:[]},403,{Origin:'https://invalid.example'});
 await call('packing/check',{id,revision:o.revision,itemIds:[]},415,{'Content-Type':'text/plain'});
 if(!(await call('data')).logistics.couriers.some(c=>c.id===A))await call('delivery/couriers',{id:A,name:'Próba futár A',phone:'0000000000',vehicle:'Test',note:''},201);
 await call('delivery/assign',{id,revision:o.revision,courierId:A,note:'Packing API test'});await reload();
 assert.equal((await call('orders/state',{id,revision:o.revision,field:'delivery',value:'transit'},400)).error,'PACKING_REQUIRED');
 fixture('courier-fixture.py','driver');assert.equal((await call('courier/state',{requestId:randomUUID(),orderId:id,revision:o.revision,value:'transit',note:''},400)).error,'PACKING_REQUIRED');await call('packing?date='+day,undefined,403);await call('packing/check',{id,revision:o.revision,itemIds:[]},403);
 fixture('courier-fixture.py','admin');fixture('access-fixture.py','kitchen');const kitchen=await call('packing?date='+day);assert.ok(kitchen.orders.some(o=>o.id===id));assert.ok(!JSON.stringify(kitchen).includes('PRIVATE TEST ADDRESS'));
 const command={id,revision:o.revision,itemIds:[o.items[0].id]},race=await Promise.all([raw('packing/check',command),raw('packing/check',command)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);await reload();assert.equal(o.packingReady,0);assert.equal(o.checkedItemIds.length,1);assert.equal(o.packingCheckedAt,'');await call('packing/check',command,409);
 await call('packing/check',{id,revision:o.revision,itemIds:o.items.map(i=>i.id)});await reload();assert.equal(o.packingReady,1);assert.ok(o.packingCheckedAt);
 await call('packing/check',{id,revision:o.revision,itemIds:[]});await reload();assert.equal(o.packingReady,0);assert.equal(o.checkedItemIds.length,0);
 await call('packing/check',{id,revision:o.revision,itemIds:o.items.map(i=>i.id)});await reload();fixture('courier-fixture.py','admin');
 const before=await call('data'),auditBefore=before.audit.filter(a=>a.entity===id&&a.action==='packing_checked');assert.equal(auditBefore.length,4);
 await call('orders/state',{id,revision:o.revision,field:'delivery',value:'transit'});await reload();await call('packing/check',{id,revision:o.revision,itemIds:[]},400);await call('orders/state',{id,revision:o.revision,field:'delivery',value:'delivered'});await reload();await call('packing/check',{id,revision:o.revision,itemIds:[]},400);
 const after=await call('data'),saved=after.orders.find(o=>o.id===id);assert.equal(saved.payment,'unpaid');assert.deepEqual(after.operations.moves,before.operations.moves);assert.deepEqual(after.operations.lots,before.operations.lots);assert.deepEqual(after.operations.issues,before.operations.issues);assert.equal(after.audit.filter(a=>a.entity===id&&a.action==='packing_checked').length,4);
 for(const role of ['warehouse','pending','disabled']){fixture('access-fixture.py',role);await call('packing?date='+day,undefined,403);await call('packing/check',{id,revision:o.revision,itemIds:[]},403);}fixture('courier-fixture.py','admin');
 const browserId=await create('LOCAL_PACKING_BROWSER');console.log('Browser fixture:',browserId,'customer:',customer.id);
 console.log('PASS packing: scoped snapshots, unready/invalid/duplicate/stale/origin/type/role guards, partial persistence, concurrent CAS+audit, full confirmation/reopen, staff/courier dispatch guards, post-dispatch lock, unchanged stock/payment');
}finally{fixture('courier-fixture.py','restore');}
