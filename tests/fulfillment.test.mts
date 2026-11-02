import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {quoteFulfillment,validatePolicy,parseMoney,closedDay,normalizePolicy,fulfillmentTime,type FulfillmentPolicy} from '../src/modules/fulfillment/domain.ts';
// @ts-ignore
import {nextState,total,type Order} from '../src/modules/shared/domain.ts';
// @ts-ignore
import {canAssign,deliveryList} from '../src/modules/delivery/domain.ts';
const policy:FulfillmentPolicy={deliveryEnabled:true,pickupEnabled:true,pickupHu:'Test HU',pickupRo:'Test RO',pickupMinimum:500,closedWeekdays:[],closedDates:[],zones:[{id:'z',hu:'Nyújtód',ro:'Lunga',fee:750,minimum:1000,active:true},{id:'off',hu:'Bereck',ro:'Brețcu',fee:0,minimum:0,active:false}]};
const input={mode:'delivery' as const,zoneId:'z',date:'2026-11-02',time:'11:00'},now=new Date('2026-10-29T10:00:00Z');
test('Delivery zone is chosen by name (id); fee and food-only minimum resolve server-side; pickup has no shipping fee',()=>{
 const q=quoteFulfillment(policy,input,1000,now);assert.equal(q.fee,750);assert.equal(q.zoneHu,'Nyújtód');assert.equal(q.zoneId,'z');assert.equal(q.postalCode,'');
 assert.throws(()=>quoteFulfillment(policy,input,999,now),/MINIMUM/);
 assert.throws(()=>quoteFulfillment(policy,{...input,zoneId:'missing'},2000,now),/ZONE/);
 assert.throws(()=>quoteFulfillment(policy,{...input,zoneId:'off'},2000,now),/ZONE/);
 const pickup=quoteFulfillment(policy,{...input,mode:'pickup',zoneId:''},500,now);assert.equal(pickup.fee,0);assert.equal(pickup.addressRo,'Test RO');
 assert.throws(()=>quoteFulfillment(policy,{...input,mode:'pickup'},500,now),/VALIDATION/);
 assert.equal(parseMoney('12,34'),1234);assert.equal(parseMoney('0.1'),10);assert.throws(()=>parseMoney('1.001'),/MONEY/);
});
test('Wanted time is optional (as soon as possible) and must not be in the past',()=>{
 const asap=quoteFulfillment(policy,{...input,time:''},2000,now);assert.equal(asap.asap,true);assert.equal(asap.start,'');assert.equal(fulfillmentTime(asap),'');
 const later=quoteFulfillment(policy,input,2000,now);assert.equal(later.asap,false);assert.equal(fulfillmentTime(later),'11:00');
 const sameDay=new Date('2026-11-02T10:00:00Z');// 12:00 Bukarestben
 assert.throws(()=>quoteFulfillment(policy,{...input,time:'11:30'},2000,sameDay),/SLOT/);
 assert.equal(quoteFulfillment(policy,{...input,time:'12:30'},2000,sameDay).start,'12:30');
 assert.throws(()=>quoteFulfillment(policy,{...input,time:'25:00'},2000,now),/SLOT/);
 assert.equal(fulfillmentTime({start:'11:00',end:'12:00'}),'11:00–12:00');
});
test('Closed dates/weekdays, disabled modes and duplicate zone names fail closed; old saved policies load without slots/postcodes',()=>{
 assert.equal(closedDay({...policy,closedWeekdays:[1]},input.date),true);
 assert.throws(()=>quoteFulfillment({...policy,closedDates:[input.date]},input,2000,now),/CLOSED/);
 assert.throws(()=>quoteFulfillment({...policy,deliveryEnabled:false},input,2000,now),/DISABLED/);
 assert.throws(()=>validatePolicy({...policy,zones:[...policy.zones,{...policy.zones[0]!,id:'dup'}]}),/ZONE_OVERLAP/);
 assert.doesNotThrow(()=>validatePolicy(policy));
 const old=normalizePolicy({...policy,zones:[{id:'z',hu:'Kezdi',ro:'Targu',postcodes:['500234'],fee:1000,minimum:0,active:true}],slots:[{id:'s'}]});
 assert.deepEqual(old.zones,[{id:'z',hu:'Kezdi',ro:'Targu',fee:1000,minimum:0,active:true}]);assert.equal('slots' in old,false);
});
test('Ready pickups hand over directly without courier assignment or manifests',()=>{
 const o={packingReady:1,id:'p',fulfillmentMode:'pickup',status:'confirmed',production:'queued',delivery:'pending',payment:'unpaid',revision:0,date:'2026-11-02',items:[{price:1000,quantity:2}],deliveryFee:750} as Order;
 assert.throws(()=>nextState(o,'delivery','delivered'),/NOT_READY/);assert.throws(()=>nextState({...o,production:'ready'},'delivery','transit'),/INVALID_TRANSITION/);
 assert.equal(nextState({...o,production:'ready'},'delivery','delivered').delivery,'delivered');assert.equal(canAssign(o),false);assert.deepEqual(deliveryList([o],o.date,'all'),[]);assert.equal(total(o),2750);
});
