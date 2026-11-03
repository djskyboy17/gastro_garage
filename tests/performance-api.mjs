// Local-only integration checks. Creates one marked, cancelled test order.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin=process.env.KITCHEN_TEST_ORIGIN??'http://127.0.0.1:5174';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local testing only');
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest'}).format(new Date());
async function publicRead(path,status=200){
  const r=await fetch(origin+path);
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));
  assert.equal(r.headers.get('cache-control'),'no-store');
  return data;
}
for(const start of [date,new Date(Date.parse(date+'T12:00Z')+5*86400000).toISOString().slice(0,10)]){
  const board=await publicRead('/api/portal/menu-board?date='+start);
  assert.deepEqual(board.today,await publicRead('/api/portal/menu?date='+start));
  assert.ok(board.week.length<=6);
  for(const day of board.week){
    const single=await publicRead('/api/portal/menu?date='+day.date);
    assert.deepEqual(day,{date:single.date,set:single.set,open:single.open});
  }
  assert.ok(!/customerId|packPrice|portalUserId|recipeSnapshot/.test(JSON.stringify(board)));
}
await publicRead('/api/portal/menu-board?date=2026-02-30',400);
await publicRead('/api/portal/menu-board?date=2099-01-01',400);
await publicRead('/api/data',401);
const cookie=(await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'})).headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie,'Local preview mock login');
async function staff(path,body,status=200,extra={}){
  const r=await fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});
  const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data={error:raw};}
  assert.equal(r.status,status,path+': '+JSON.stringify(data));return data;
}
const initial=await staff('data');
assert.ok(initial.products.length&&initial.customers.length,'Existing local sample data required');
const saved=new Set((await staff('menu')).days.map(day=>day.date));
const orderDate=Array.from({length:30},(_,i)=>new Date(Date.parse(date+'T12:00Z')+(i+1)*86400000).toISOString().slice(0,10)).find(day=>!saved.has(day));
assert.ok(orderDate,'Unused future day for the cancelled test order');
const p=initial.products.find(p=>p.active),id=randomUUID();
const input={id,customerId:initial.customers[0].id,date:orderDate,time:'12:15',note:'LOCAL PERFORMANCE REGRESSION',items:[{productId:p.id,quantity:1}]};
await staff('orders',input,403,{Origin:'https://example.invalid'});
await staff('orders',input,201);
await staff('orders',input);
let data=await staff('data'),order=data.orders.find(o=>o.id===id);
assert.equal(data.orders.filter(o=>o.id===id).length,1);
assert.equal(order.items.length,1);assert.equal(order.items[0].hu,p.hu);assert.equal(order.items[0].price,p.price);assert.equal(order.items[0].allergens,p.allergens);
const latest=initial.operations.recipes.filter(r=>r.productId===p.id).sort((a,b)=>b.version-a.version)[0];
assert.equal(order.items[0].recipeId,latest?.id??null,'Latest recipe identifier is still snapshotted');
assert.deepEqual(data.operations.lots,initial.operations.lots,'Order creation consumes no stock');
assert.deepEqual(data.operations.moves,initial.operations.moves);
await staff('orders/state',{id,revision:0,field:'payment',value:'paid'});
await staff('orders/state',{id,revision:0,field:'payment',value:'paid'},409);
data=await staff('data');order=data.orders.find(o=>o.id===id);
assert.equal(order.payment,'paid');assert.equal(order.revision,1);
assert.equal(order.items[0].hu,p.hu);assert.equal(order.items[0].price,p.price);
assert.equal(data.audit.filter(a=>a.entity===id&&a.action==='order_created').length,1);
// Existing v50 cancellation removes a queued order and its associated rows.
await staff('orders/state',{id,revision:1,field:'status',value:'cancelled'});
assert.ok(!(await staff('data')).orders.some(o=>o.id===id));
console.log('PASS local API: board/single-day equivalence, Sunday rollover, fresh reads, public isolation, auth/origin, idempotent order, snapshots, no stock consumption, stale revision and reload');
