import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {quoteFulfillment,validatePolicy,parseMoney,closedDay,type FulfillmentPolicy} from '../src/modules/fulfillment/domain.ts';
// @ts-ignore
import {nextState,total,type Order} from '../src/modules/shared/domain.ts';
// @ts-ignore
import {canAssign,deliveryList} from '../src/modules/delivery/domain.ts';
const policy:FulfillmentPolicy={deliveryEnabled:true,pickupEnabled:true,pickupHu:'Test HU',pickupRo:'Test RO',pickupMinimum:500,closedWeekdays:[],closedDates:[],zones:[{id:'z',hu:'Test',ro:'Test',postcodes:['000000'],fee:750,minimum:1000,active:true}],slots:[{id:'d',mode:'delivery',weekdays:[1,2,3,4,5,6,7],start:'11:00',end:'12:00',capacity:2,active:true},{id:'p',mode:'pickup',weekdays:[1,2,3,4,5,6,7],start:'11:00',end:'12:00',capacity:2,active:true}]};
const input={mode:'delivery' as const,slotId:'d',postalCode:'000000',date:'2026-11-02',time:'11:00'},now=new Date('2026-10-29T10:00:00Z');
test('Delivery fee and food-only minimum resolve server-side; pickup has no shipping fee',()=>{
 const q=quoteFulfillment(policy,input,1000,now);assert.equal(q.fee,750);assert.equal(q.zoneHu,'Test');
 assert.throws(()=>quoteFulfillment(policy,input,999,now),/MINIMUM/);assert.throws(()=>quoteFulfillment(policy,{...input,postalCode:'111111'},2000,now),/ZONE/);
 const pickup=quoteFulfillment(policy,{...input,mode:'pickup',slotId:'p',postalCode:''},500,now);assert.equal(pickup.fee,0);assert.equal(pickup.addressRo,'Test RO');
 assert.equal(parseMoney('12,34'),1234);assert.equal(parseMoney('0.1'),10);assert.throws(()=>parseMoney('1.001'),/MONEY/);
});
test('Closed dates/weekdays, disabled modes and overlapping slots fail closed',()=>{
 assert.equal(closedDay({...policy,closedWeekdays:[1]},input.date),true);
 assert.throws(()=>quoteFulfillment({...policy,closedDates:[input.date]},input,2000,now),/CLOSED/);
 assert.throws(()=>quoteFulfillment({...policy,deliveryEnabled:false},input,2000,now),/DISABLED/);
 assert.throws(()=>quoteFulfillment(policy,{...input,time:'11:30'},2000,now),/SLOT/);
 assert.throws(()=>validatePolicy({...policy,slots:[...policy.slots,{...policy.slots[0],id:'dup'}]}),/SLOT_OVERLAP/);
 assert.throws(()=>validatePolicy({...policy,zones:[...policy.zones,{...policy.zones[0],id:'dup'}]}),/ZONE_OVERLAP/);
 assert.doesNotThrow(()=>validatePolicy(policy));
});
test('Ready pickups hand over directly without courier assignment or manifests',()=>{
 const o={packingReady:1,id:'p',fulfillmentMode:'pickup',status:'confirmed',production:'queued',delivery:'pending',payment:'unpaid',revision:0,date:'2026-11-02',items:[{price:1000,quantity:2}],deliveryFee:750} as Order;
 assert.throws(()=>nextState(o,'delivery','delivered'),/NOT_READY/);assert.throws(()=>nextState({...o,production:'ready'},'delivery','transit'),/INVALID_TRANSITION/);
 assert.equal(nextState({...o,production:'ready'},'delivery','delivered').delivery,'delivered');assert.equal(canAssign(o),false);assert.deepEqual(deliveryList([o],o.date,'all'),[]);assert.equal(total(o),2750);
});
