import {randomUUID} from 'node:crypto';
// Local API-test setup only; never imported by application code.
export async function ensureFulfillment(call){
 const data=await call('fulfillment');
 const delivery=data.policy.slots.find(s=>s.mode==='delivery'&&s.start==='12:00'&&s.end==='13:00'&&s.weekdays.length===7)??{id:randomUUID(),mode:'delivery',weekdays:[1,2,3,4,5,6,7],start:'12:00',end:'13:00',capacity:10000,active:true};
 const pickup=data.policy.slots.find(s=>s.mode==='pickup'&&s.start==='12:00'&&s.end==='13:00'&&s.weekdays.length===7)??{id:randomUUID(),mode:'pickup',weekdays:[1,2,3,4,5,6,7],start:'12:00',end:'13:00',capacity:10000,active:true};
 const zone={id:randomUUID(),hu:'LOCAL TEST ZONE',ro:'LOCAL TEST ZONE',postcodes:['000000'],fee:0,minimum:0,active:true};
 await call('fulfillment/save',{revision:data.revision,policy:{deliveryEnabled:true,pickupEnabled:true,pickupHu:'LOCAL pickup test address',pickupRo:'LOCAL pickup test address',pickupMinimum:0,closedWeekdays:[],closedDates:[],zones:[zone],slots:[{...delivery,capacity:10000,active:true},{...pickup,capacity:10000,active:true}]}});
 return {mode:'delivery',slotId:delivery.id,postalCode:'000000'};
}
