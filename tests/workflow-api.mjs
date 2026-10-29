// Cross-module regression. All identity fixtures and state are LOCAL preview only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {ensureFulfillment} from './fulfillment-fixture.mjs';
const origin='http://127.0.0.1:5173',python=process.env.KITCHEN_TEST_PYTHON;
assert.ok(python,'Set KITCHEN_TEST_PYTHON to the local Python executable');
const contextPath=new URL('../work/workflow-context.json',import.meta.url);
const fixture=(file,...args)=>execFileSync(python,['tests/'+file,...args],{stdio:'pipe'});
const cookie=(await fetch(origin+'/signin-with-chatgpt?return_to=/portal',{redirect:'manual'})).headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
async function call(path,body,status=200){const r=await fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,path+': '+JSON.stringify(d));return d;}
const state=()=>call('data');
const A='c1111111-1111-4111-8111-111111111111';
const action=process.argv[2]??'run';
async function setup(){
 fixture('courier-fixture.py','admin');fixture('portal-fixture.py');
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest'}).format(new Date());
 const target=new Date(day+'T12:00:00Z');target.setUTCDate(target.getUTCDate()+1);const date=target.toISOString().slice(0,10);
 const key=randomUUID().slice(0,6),note='LOCAL FULL FLOW '+key;
 const ingredient=await call('operations/ingredients',{hu:'Próbaliszt '+key,ro:'Făină de test '+key,unit:'g',packQuantity:1000,packPrice:500,minStock:0,supplier:'LOCAL TEST',allergens:'gluten'},201);
 const product=await call('products',{hu:'Próbaebéd '+key,ro:'Prânz de test '+key,descriptionHu:'Kitalált teljesfolyamat-próba',descriptionRo:'Test fictiv al fluxului complet',category:'main',price:2500,portion:300,allergens:''},201);
 const recipe=await call('operations/recipes',{productId:product.id,yield:10,note:'Local workflow v1',lines:[{ingredientId:ingredient.id,quantity:1000,lossBps:0}]},201);
 await call('portal/catalog-setting',{productId:product.id,revision:0,visible:1});
 const fulfillment=await ensureFulfillment(call),menus=await call('menu'),existing=menus.days.find(d=>d.date===date);
 await call('menu/save',{date,revision:existing?.revision??null,active:1,cutoff:date+'T09:00',items:[...menus.lines.filter(l=>l.date===date).map(l=>({productId:l.productId,capacity:l.capacity})),{productId:product.id,capacity:10}]});
 const me=await call('portal/me');await call('portal/profile',{name:'Teljes folyamat próba '+key,address:'Kitalált teszt utca 12',phone:'0000000000',...(me.profile?{revision:me.profile.revision}:{})},me.profile?200:201);
 const c={key,note,day,date,ingredientId:ingredient.id,productId:product.id,recipeId:recipe.id,fulfillment,courierId:A};
 writeFileSync(contextPath,JSON.stringify(c,null,2));return c;
}
async function staff(c){
 fixture('courier-fixture.py','admin');
 let d=await state(),o=d.orders.find(o=>o.note===c.note);assert.ok(o,'Submit the prepared portal order first');c.orderId=o.id;
 assert.equal(o.status,'requested');assert.equal(o.production,'queued');assert.equal(o.items.length,1);assert.equal(o.items[0].quantity,2);assert.equal(o.items[0].price,2500);assert.equal(o.items[0].recipeId,c.recipeId);assert.equal(o.items[0].allergens,'gluten');
 assert.equal(d.operations.lots.filter(l=>l.ingredientId===c.ingredientId).length,0,'Creation must not consume or create stock');
 await call('orders/state',{id:o.id,revision:o.revision,field:'production',value:'cooking'},400);
 await call('orders/state',{id:o.id,revision:o.revision,field:'status',value:'confirmed',note:'Tesztkérés jóváhagyva / Cerere de test confirmată'});
 o=(await state()).orders.find(o=>o.id===c.orderId);
 const issue={orderId:o.id,revision:o.revision,recipeIds:[c.recipeId],note:'LOCAL FULL FLOW',actual:[{ingredientId:c.ingredientId,quantity:200}]};
 assert.equal((await call('operations/issue',issue,400)).error,'INSUFFICIENT_STOCK');
 assert.equal((await state()).orders.find(row=>row.id===c.orderId)?.production,'queued');
 // Actual supplier order → confirmation → goods receipt creates the usable lot.
 const supplierId=randomUUID();await call('purchasing/suppliers',{id:supplierId,name:'Fiktív próbabeszállító '+c.key,taxId:'',address:'Kitalált cím',email:'',phone:'',note:'LOCAL ONLY'},201);
 const purchaseId=randomUUID();await call('purchasing/create',{id:purchaseId,supplierId,due:c.day,note:'LOCAL FULL FLOW',lines:[{ingredientId:c.ingredientId,quantity:1000,packQuantity:1000,packPrice:500}]},201);
 await call('purchasing/state',{id:purchaseId,revision:0,action:'confirm',note:''});
 const po=(await state()).purchasing.orders.find(p=>p.id===purchaseId);c.receiptId=randomUUID();
 const receipt={id:c.receiptId,purchaseId,revision:po.revision,lineId:po.lines[0].id,quantity:1000,batch:'FLOW-'+c.key,received:c.day,expires:c.date,totalCost:500,document:'LOCAL TEST'};
 await call('purchasing/receive',receipt,201);await call('purchasing/receive',receipt);
 // A new recipe and changed profile must not rewrite the already-saved order.
 await call('operations/recipes',{productId:c.productId,yield:10,note:'Local workflow v2',lines:[{ingredientId:c.ingredientId,quantity:2000,lossBps:0}]},201);
 let me=await call('portal/me');await call('portal/profile',{name:'Módosított próbanév',address:'Másik kitalált tesztcím',phone:'1111111111',revision:me.profile.revision});
 await call('operations/issue',issue,201);await call('operations/issue',issue);
 d=await state();o=d.orders.find(o=>o.id===c.orderId);assert.equal(o.production,'cooking');assert.equal(o.address,'Kitalált teszt utca 12');assert.equal(o.items[0].recipeId,c.recipeId);assert.equal(d.operations.lots.find(l=>l.id===c.receiptId).remaining,800);
 const issued=d.operations.issues.filter(i=>i.orderId===o.id);assert.equal(issued.length,1);assert.equal(d.operations.moves.filter(m=>m.issueId===issued[0].id).reduce((n,m)=>n+m.quantity,0),-200);
 await call('orders/state',{id:o.id,revision:o.revision-1,field:'production',value:'ready'},409);
 await call('orders/state',{id:o.id,revision:o.revision,field:'production',value:'ready'});
 const couriers=(await state()).logistics.couriers;if(!couriers.some(x=>x.id===A))await call('delivery/couriers',{id:A,name:'Próba futár A',phone:'0000000000',vehicle:'Próba jármű',note:'LOCAL ONLY'},201);
 o=(await state()).orders.find(o=>o.id===c.orderId);await call('packing/check',{id:o.id,revision:o.revision,itemIds:o.items.map(i=>i.id)});o=(await state()).orders.find(o=>o.id===c.orderId);await call('delivery/assign',{id:o.id,revision:o.revision,courierId:A,note:'LOCAL FULL FLOW'});
 writeFileSync(contextPath,JSON.stringify(c,null,2));fixture('courier-fixture.py','driver');
 const tasks=await call('courier/tasks?date='+c.date);assert.ok(tasks.tasks.some(t=>t.id===c.orderId));
 console.log('PASS staff chain: requested → confirmed → supplier purchase/receipt → immutable recipe/profile snapshots → single 200g issue → ready → courier assignment');
}
async function verify(c){
 fixture('courier-fixture.py','admin');const d=await state(),o=d.orders.find(o=>o.id===c.orderId);assert.equal(o.delivery,'delivered');assert.equal(o.production,'ready');assert.equal(o.payment,'unpaid');assert.equal(o.address,'Kitalált teszt utca 12');assert.equal(o.items[0].price,2500);assert.equal(o.items[0].allergens,'gluten');assert.equal(d.operations.lots.find(l=>l.id===c.receiptId).remaining,800);
 const me=await call('portal/me'),mine=me.orders.find(x=>x.id===c.orderId);assert.equal(mine.delivery,'delivered');assert.equal(mine.address,o.address);assert.equal(mine.items[0].price,2500);
 const events=d.logistics.events.filter(e=>e.orderId===o.id);assert.equal(events.filter(e=>e.kind==='transit').length,1);assert.equal(events.filter(e=>e.kind==='delivered').length,1);assert.equal(d.operations.issues.filter(i=>i.orderId===o.id).length,1);
 console.log('PASS persisted customer/staff/delivery agreement: ready+delivered, immutable names/price/address/allergens, exactly one stock deduction and one departure/handover, payment unchanged');
}
try{
 if(action==='setup'){const c=await setup();console.log(JSON.stringify({date:c.date,note:c.note,dish:'Próbaebéd '+c.key}));}
 else if(action==='staff')await staff(JSON.parse(readFileSync(contextPath)));
 else if(action==='verify')await verify(JSON.parse(readFileSync(contextPath)));
 else if(action==='run'){
  const c=await setup(),input={...c.fulfillment,date:c.date,time:'12:00',note:c.note,items:[{productId:c.productId,quantity:2}]},preview=await call('portal/preview',input),request={...input,id:randomUUID(),quote:preview.quote};
  await call('portal/orders',request,201);await call('portal/orders',request);await staff(c);
  let task=(await call('courier/tasks?date='+c.date)).tasks.find(t=>t.id===c.orderId);
  const start={requestId:randomUUID(),orderId:task.id,revision:task.revision,value:'transit',note:'Local flow departure'};await call('courier/state',start);await call('courier/state',start);
  task=(await call('courier/tasks?date='+c.date)).tasks.find(t=>t.id===c.orderId);await call('courier/state',{requestId:randomUUID(),orderId:task.id,revision:task.revision,value:'delivered',note:'Local flow handover'});await verify(c);
 }else throw Error('Unknown test action');
}finally{fixture('courier-fixture.py','restore');}
