import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node native type stripping
import {packingOrder,packingSelection,workPlan,needsPacking} from '../src/modules/packing/domain.ts';
// @ts-ignore
import {canCheckPacking,nextState,type Order} from '../src/modules/shared/domain.ts';
// @ts-ignore
import {canWrite,tabsFor,type Role} from '../src/modules/access/domain.ts';
const order={id:'o',customerName:'Example',date:'2026-10-29',time:'12:00',status:'confirmed',production:'ready',delivery:'pending',revision:3,courierId:'c',address:'PRIVATE',phone:'PRIVATE',payment:'paid',items:[{id:'i',hu:'Leves',ro:'Supă',quantity:2,allergens:'milk',price:2000}],packingItems:'[]',packingReady:0} as unknown as Order;
test('Packing requires every own row exactly once; empty and partial lists cannot mark complete',()=>{
 assert.equal(packingSelection(order.items,[]).ready,false);assert.equal(packingSelection(order.items,['i']).ready,true);assert.equal(packingSelection([],[]).ready,false);assert.equal(packingSelection([...order.items,{id:'j'}],['i']).ready,false);assert.throws(()=>packingSelection(order.items,['foreign']),/PACKING_ITEMS/);assert.throws(()=>packingSelection(order.items,['i','i']),/PACKING_ITEMS/);
});
test('Packing projection uses saved bilingual items and strips financial/contact fields',()=>{
 const p=packingOrder({...order,packingItems:'["i"]'});assert.deepEqual(p.checkedItemIds,['i']);assert.equal(p.items[0].ro,'Supă');for(const key of ['address','phone','payment','customerId','courierId','packingItems'])assert.equal(key in p,false);assert.equal('price' in p.items[0],false);assert.deepEqual(packingOrder({...order,packingItems:'broken'}).checkedItemIds,[]);
});
test('Work plan separates saved allergen/name/window snapshots and tracks three portion totals',()=>{
 const a=packingOrder(order),b=packingOrder({...order,packingReady:1}),c=packingOrder({...order,production:'cooking',items:order.items.map(i=>({...i,allergens:'egg'}))});const rows=workPlan([a,b,c]);assert.equal(rows.length,2);assert.deepEqual(rows.find(r=>r.allergens==='milk'),{time:'12:00',windowEnd:'',hu:'Leves',ro:'Supă',allergens:'milk',quantity:4,ready:4,packed:2});assert.equal(rows.find(r=>r.allergens==='egg')?.ready,0);assert.equal(workPlan([a,{...a,time:'13:00'}]).length,2);
});
test('Packing transitions guard every departure and pickup while preserving historical in-transit completion',()=>{
 assert.equal(canCheckPacking(order),true);for(const patch of [{status:'requested'},{production:'cooking'},{delivery:'transit'},{delivery:'delivered'}])assert.equal(canCheckPacking({...order,...patch}),false);
 assert.throws(()=>nextState(order,'delivery','transit'),/PACKING_REQUIRED/);assert.throws(()=>nextState({...order,fulfillmentMode:'pickup'},'delivery','delivered'),/PACKING_REQUIRED/);assert.equal(nextState({...order,packingReady:1},'delivery','transit').delivery,'transit');assert.equal(nextState({...order,delivery:'transit'},'delivery','delivered').delivery,'delivered');
});
test('Packing checking is restricted to supervisors, kitchen and dispatcher',()=>{
 for(const role of ['owner','admin','kitchen','dispatcher'] as Role[]){assert.equal(canWrite(role,'/api/packing/check',{}),true);assert.ok(tabsFor(role).includes('packing'));}for(const role of ['warehouse','courier','pending','disabled'] as Role[]){assert.equal(canWrite(role,'/api/packing/check',{}),false);assert.ok(!tabsFor(role).includes('packing'));}
});
test('Packing lists only orders not yet taken away',()=>{
 assert.equal(needsPacking({delivery:'pending'}),true);
 assert.equal(needsPacking({delivery:'failed'}),true);
 assert.equal(needsPacking({delivery:'transit'}),false);
 assert.equal(needsPacking({delivery:'delivered'}),false);
});
