import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node native type stripping
import {packingOrder,needsPacking} from '../src/modules/packing/domain.ts';
// @ts-ignore
import {nextState,type Order} from '../src/modules/shared/domain.ts';
// @ts-ignore
import {canWrite,tabsFor,type Role} from '../src/modules/access/domain.ts';
const order={id:'o',customerName:'Example',date:'2026-10-29',time:'12:00',status:'confirmed',production:'ready',delivery:'pending',revision:3,courierId:'c',address:'PRIVATE',phone:'PRIVATE',payment:'paid',items:[{id:'i',hu:'Leves',ro:'Supă',quantity:2,allergens:'milk',price:2000}],packingItems:'[]',packingReady:0} as unknown as Order;
test('Packing projection uses saved bilingual items and strips financial/contact fields',()=>{
 const p=packingOrder(order);assert.equal(p.items[0].ro,'Supă');for(const key of ['address','phone','payment','customerId','courierName','deliveryFee','packingReady','checkedItemIds'])assert.equal(key in p,false);
});
test('v53: no packing check – departure and pickup need only ready food',()=>{
 assert.equal(nextState(order,'delivery','transit').delivery,'transit');
 assert.equal(nextState({...order,fulfillmentMode:'pickup'},'delivery','delivered').delivery,'delivered');
 assert.throws(()=>nextState({...order,production:'cooking'},'delivery','transit'),/NOT_READY/);
});
test('v53: the packing check endpoint is gone; the Csomagolás tab (labels) stays',()=>{
 for(const role of ['owner','admin','kitchen','warehouse','dispatcher'] as Role[]){assert.equal(canWrite(role,'/api/packing/check',{}),false);assert.ok(tabsFor(role).includes('packing'));}
});
test('Packing lists only orders not yet taken away',()=>{
 assert.equal(needsPacking({delivery:'pending'}),true);
 assert.equal(needsPacking({delivery:'failed'}),true);
 assert.equal(needsPacking({delivery:'transit'}),false);
 assert.equal(needsPacking({delivery:'delivered'}),false);
});
