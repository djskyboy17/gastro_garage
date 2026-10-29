import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ensureFulfillment} from './fulfillment-fixture.mjs';
const origin='http://127.0.0.1:5173',python=process.env.KITCHEN_TEST_PYTHON;assert.ok(python);
const cookie=(await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'})).headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
async function raw(path,body,anon=false){const r=await fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{...(!anon?{Cookie:cookie}:{}),Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function call(path,body,status=200,anon=false){const r=await raw(path,body,anon);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
const fixture=role=>execFileSync(python,['tests/access-fixture.py',role],{stdio:'pipe'});fixture('restore');execFileSync(python,['tests/portal-fixture.py'],{stdio:'pipe'});
const fulfill=await ensureFulfillment(call),base=await call('fulfillment');
const future=new Date(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest'}).format(new Date())+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+3);const date=future.toISOString().slice(0,10);
const product=await call('products',{hu:'LOCAL DELIVERY '+randomUUID().slice(0,6),ro:'LOCAL DELIVERY',descriptionHu:'Próba',descriptionRo:'Test',category:'main',price:1000,portion:200,allergens:''},201);await call('portal/catalog-setting',{productId:product.id,revision:0,visible:1});
const menus=await call('menu'),day=menus.days.find(d=>d.date===date);await call('menu/save',{date,revision:day?.revision??null,cutoff:date+'T09:00',active:1,items:[...menus.lines.filter(l=>l.date===date).map(l=>({productId:l.productId,capacity:l.capacity})),{productId:product.id,capacity:1000}]});
let me=await call('portal/me');if(!me.profile)await call('portal/profile',{name:'LOCAL DELIVERY CUSTOMER',address:'LOCAL fictional address',phone:'0000000000'},201);
const slot={id:randomUUID(),mode:'delivery',weekdays:[1,2,3,4,5,6,7],start:'14:00',end:'15:00',capacity:1,active:true};
let p={...base.policy,zones:base.policy.zones.map(z=>({...z,fee:750,minimum:2000})),slots:[...base.policy.slots,slot]};
async function update(policy){const d=await call('fulfillment');await call('fulfillment/save',{revision:d.revision,policy});p=policy;}
await update(p);
let input={...fulfill,slotId:slot.id,date,time:'14:00',note:'LOCAL DELIVERY TEST',items:[{productId:product.id,quantity:2}]};
await call('portal/preview',{...input,postalCode:'999999'},400);await call('portal/preview',{...input,items:[{productId:product.id,quantity:1}]},400);await call('portal/preview',{...input,time:'14:30'},400);await call('portal/preview',{...input,deliveryFee:0},400);
await update({...p,closedDates:[date]});await call('portal/preview',input,400);assert.equal((await call('portal/fulfillment?date='+date,undefined,200,true)).closed,true);
await update({...p,closedDates:[]});let preview=await call('portal/preview',input);assert.equal(preview.subtotal,2000);assert.equal(preview.total,2750);assert.equal(preview.fulfillment.fee,750);
const old=preview;await update({...p,zones:p.zones.map(z=>({...z,fee:800}))});await call('portal/orders',{...input,id:randomUUID(),quote:old.quote},409);preview=await call('portal/preview',input);
const races=await Promise.all([1,2].map(()=>raw('portal/orders',{...input,id:randomUUID(),quote:preview.quote})));assert.deepEqual(races.map(r=>r.status).sort(),[201,409],JSON.stringify(races));let id=races.find(r=>r.status===201).data.orderId;
assert.equal((await call('portal/fulfillment?date='+date,undefined,200,true)).slots.find(s=>s.id===slot.id).remaining,0);
let policyState=await call('fulfillment');await call('fulfillment/save',{revision:policyState.revision,policy:{...p,slots:p.slots.map(s=>s.id===slot.id?{...s,capacity:0}:s)}},409);
await call('fulfillment/save',{revision:policyState.revision,policy:{...p,slots:p.slots.map(s=>s.id===slot.id?{...s,start:'15:00',end:'16:00'}:s)}},400);
await call('portal/cancel',{id,revision:0});assert.equal((await call('portal/fulfillment?date='+date,undefined,200,true)).slots.find(s=>s.id===slot.id).remaining,1);
preview=await call('portal/preview',input);const request={...input,id:randomUUID(),quote:preview.quote};const replayRace=await Promise.all([raw('portal/orders',request),raw('portal/orders',request)]);assert.deepEqual(replayRace.map(r=>r.status).sort(),[200,201],JSON.stringify(replayRace));id=replayRace[0].data.orderId;assert.equal(replayRace[1].data.orderId,id);assert.equal((await call('portal/orders',request)).orderId,id);
await update({...p,zones:p.zones.map(z=>({...z,fee:990}))});let own=(await call('portal/me')).orders.find(o=>o.id===id);assert.equal(own.deliveryFee,800);assert.equal(own.fulfillment.fee,800);assert.equal(own.fulfillment.end,'15:00');
const adminOrder=(await call('data')).orders.find(o=>o.id===id);assert.equal(adminOrder.deliveryFee,800);
try{fixture('kitchen');const hidden=(await call('data')).orders.find(o=>o.id===id);assert.equal(hidden,undefined);await call('fulfillment',undefined,403);await call('fulfillment/save',{revision:0,policy:p},403);fixture('dispatcher');await call('fulfillment');await call('fulfillment/save',{revision:0,policy:p},403);fixture('warehouse');await call('fulfillment',undefined,403);}finally{fixture('restore');}
// Pickup can use an empty private address and must never dispatch to a courier.
me=await call('portal/me');await call('portal/profile',{...me.profile,address:'',revision:me.profile.revision});const pickupSlot=p.slots.find(s=>s.mode==='pickup');const pickup={...input,mode:'pickup',slotId:pickupSlot.id,postalCode:'',time:'12:00'};const q=await call('portal/preview',pickup);assert.equal(q.fulfillment.fee,0);assert.equal(q.total,2000);assert.equal(q.fulfillment.addressHu,'LOCAL pickup test address');
const pickupId=(await call('portal/orders',{...pickup,id:randomUUID(),quote:q.quote},201)).orderId;
await call('orders/state',{id:pickupId,revision:0,field:'status',value:'confirmed'});await call('orders/state',{id:pickupId,revision:1,field:'delivery',value:'delivered'},400);
await call('orders/state',{id:pickupId,revision:1,field:'production',value:'cooking'});await call('orders/state',{id:pickupId,revision:2,field:'production',value:'ready'});await call('orders/state',{id:pickupId,revision:3,field:'delivery',value:'transit'},400);
const courier=await call('delivery/couriers',{id:randomUUID(),name:'LOCAL TEST',phone:'',vehicle:'',note:''},201);await call('delivery/assign',{id:pickupId,revision:3,courierId:courier.id,note:''},400);
const pack=(await call('packing?date='+input.date)).orders.find(o=>o.id===pickupId);await call('packing/check',{id:pickupId,revision:3,itemIds:pack.items.map(i=>i.id)});await call('orders/state',{id:pickupId,revision:4,field:'delivery',value:'delivered'});const pickupOrder=(await call('portal/me')).orders.find(o=>o.id===pickupId);assert.equal(pickupOrder.delivery,'delivered');assert.ok(pickupOrder.address.includes('LOCAL pickup'));assert.equal(pickupOrder.payment,'unpaid');
// Restore a delivery address for later local regression/browser checks.
me=await call('portal/me');await call('portal/profile',{...me.profile,address:'LOCAL fictional address'});
console.log('PASS fulfillment: fees/minimums/postcodes, closed dates, stale quote, last-slot race, capacity floor, stable slot identity, cancel/replay, snapshot totals, role/redaction boundaries, pickup handover without courier');
