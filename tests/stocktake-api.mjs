import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const origin='http://127.0.0.1:5173',python=process.env.KITCHEN_TEST_PYTHON;assert.ok(python);
const cookie=(await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'})).headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
async function raw(path,body){const r=await fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function call(path,body,status=200){const r=await raw(path,body);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
const fixture=role=>execFileSync(python,['tests/access-fixture.py',role],{stdio:'pipe'});
fixture('restore');
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest'}).format(new Date()),future=new Date(today+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+10);const expires=future.toISOString().slice(0,10);
const ing=await call('operations/ingredients',{hu:'LOCAL COUNT flour '+randomUUID().slice(0,6),ro:'LOCAL COUNT făină',unit:'g',packQuantity:1000,packPrice:500,minStock:0,supplier:'LOCAL COUNT',allergens:'gluten'},201);
const lotIds=[randomUUID(),randomUUID()];
for(let i=0;i<2;i++)await call('operations/receive',{id:lotIds[i],ingredientId:ing.id,batch:'LOCAL-COUNT-'+i,supplier:'LOCAL TEST',received:today,expires,quantity:(i+1)*100,totalCost:(i+1)*50,document:'LOCAL ONLY'},201);
const data=()=>call('data');
const docs=()=>call('stocktake');
const document=async id=>(await docs()).stocktakes.find(d=>d.id===id);
const lot=async id=>(await data()).operations.lots.find(l=>l.id===id);
async function create(lots=lotIds){const input={id:randomUUID(),title:'LOCAL COUNT '+randomUUID().slice(0,6),lotIds:lots};await call('stocktake/create',input,201);await call('stocktake/create',input);await call('stocktake/create',{...input,title:'changed'},409);return document(input.id);}
async function save(doc,quantities,notes=quantities.map(()=>'')){await call('stocktake/save',{id:doc.id,revision:doc.revision,lines:doc.lines.map((l,i)=>({lotId:l.lotId,counted:quantities[i],note:notes[i]}))});return document(doc.id);}
async function waste(id,quantity=1){return call('operations/waste',{id:randomUUID(),lotId:id,quantity,note:'LOCAL COUNT test movement'});}
const created=await create();assert.ok(created.lines.every(l=>l.counted===null));
await call('stocktake/post',{id:created.id,revision:0},400);
let d=await save(created,[0,250]);await call('stocktake/post',{id:d.id,revision:d.revision},400);
try{fixture('warehouse');d=await save(d,[50,250],['Local shortage','Local surplus']);await call('stocktake/post',{id:d.id,revision:d.revision},403);await call('stocktake/reverse',{id:d.id,revision:d.revision,note:'test'},403);assert.ok((await docs()).stocktakes.some(x=>x.id===d.id));}finally{fixture('restore');}
const command={id:d.id,revision:d.revision},races=await Promise.all([raw('stocktake/post',command),raw('stocktake/post',command)]);assert.ok(races.every(r=>[200,409].includes(r.status)),JSON.stringify(races));assert.ok(races.some(r=>r.status===200));
await call('stocktake/post',command);
d=await document(d.id);assert.equal(d.status,'posted');
let state=await data();for(let i=0;i<2;i++){const l=state.operations.lots.find(l=>l.id===lotIds[i]);assert.equal(l.remaining,i?250:50);assert.equal(l.quantity,(i+1)*100);assert.equal(l.totalCost,(i+1)*50);assert.equal(l.adjustmentTotal,i?50:-50);assert.equal(l.revision,1);assert.equal(l.expires,expires);}
assert.equal(state.operations.moves.filter(m=>m.id.startsWith('count:'+d.id+':')).length,2);
const reverse={id:d.id,revision:d.revision,note:'LOCAL accidental count'};await call('stocktake/reverse',reverse);await call('stocktake/reverse',reverse);
state=await data();for(let i=0;i<2;i++){const l=state.operations.lots.find(l=>l.id===lotIds[i]);assert.equal(l.remaining,(i+1)*100);assert.equal(l.adjustmentTotal,0);assert.equal(l.revision,2);}
assert.equal((await document(d.id)).status,'reversed');assert.ok((await document(d.id)).postedAt);
await call('stocktake/save',{id:d.id,revision:99,lines:[]},400);
// A stale line rolls back the whole count, even if its balance returns to the baseline (ABA).
let stale=await create();stale=await save(stale,[80,180],['Count A','Count B']);await waste(lotIds[0]);
let correction=await create([lotIds[0]]);correction=await save(correction,[100],['Restore test baseline']);await call('stocktake/post',{id:correction.id,revision:correction.revision});assert.equal((await lot(lotIds[0])).remaining,100);
await call('stocktake/post',{id:stale.id,revision:stale.revision},409);assert.equal((await lot(lotIds[1])).remaining,200);assert.equal((await document(stale.id)).status,'draft');
await call('stocktake/refresh-line',{id:stale.id,revision:stale.revision,lotId:lotIds[0]});stale=await document(stale.id);assert.equal(stale.lines.find(l=>l.lotId===lotIds[0]).counted,null);
stale=await save(stale,[0,180],['Count to zero','Shortage']);await call('stocktake/post',{id:stale.id,revision:stale.revision});stale=await document(stale.id);
await waste(lotIds[1]);await call('stocktake/reverse',{id:stale.id,revision:stale.revision,note:'Changed stock'},409);assert.equal((await lot(lotIds[0])).remaining,0);assert.equal((await lot(lotIds[1])).remaining,179);
const cancelled=await create([lotIds[1]]),cancel={id:cancelled.id,revision:0,note:'LOCAL unused count'};await call('stocktake/cancel',cancel);await call('stocktake/cancel',cancel);assert.equal((await document(cancelled.id)).status,'cancelled');
for(const role of ['dispatcher','kitchen','pending','disabled']){try{fixture(role);await call('stocktake',undefined,403);await call('stocktake/create',{id:randomUUID(),title:'forbidden',lotIds},403);}finally{fixture('restore');}}
assert.equal((await fetch(origin+'/api/stocktake')).status,401);
assert.equal((await fetch(origin+'/api/stocktake/create',{method:'POST',headers:{Cookie:cookie,Origin:'https://invalid.example','Content-Type':'application/json'},body:'{}'})).status,403);
console.log('PASS stocktake: draft/zero/reasons, surplus and shortage, atomic revision guards incl ABA, post/reverse idempotency, concurrent clicks, immutable receipts, stale re-count, reversal after movement denied, cancellation and roles');
