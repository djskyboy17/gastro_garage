import {randomUUID} from 'node:crypto';
// Local API-test setup only; never imported by application code.
// v58: a körzet név szerint választható (zoneId), nincs irányítószám és idősáv; az időpont üres = minél előbb.
export async function ensureFulfillment(call){
 const data=await call('fulfillment');
 const zone=data.policy.zones.find(z=>z.hu==='LOCAL TEST ZONE')??{id:randomUUID(),hu:'LOCAL TEST ZONE',ro:'LOCAL TEST ZONE',fee:0,minimum:0,active:true};
 await call('fulfillment/save',{revision:data.revision,policy:{deliveryEnabled:true,pickupEnabled:true,pickupHu:'LOCAL pickup test address',pickupRo:'LOCAL pickup test address',pickupMinimum:0,closedWeekdays:[],closedDates:[],zones:[{...zone,active:true}]}});
 return {mode:'delivery',zoneId:zone.id};
}
