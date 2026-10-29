import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node test imports
import {canAssign,deliveryList} from "../src/modules/delivery/domain.ts";
// @ts-ignore Native Node test imports
import {nextState,type Order} from "../src/modules/shared/domain.ts";
const base: Order = {packingReady:1,id:"o1",customerId:"c1",customerName:"Example",address:"Example",phone:"",date:"2026-10-29",time:"12:00",note:"",production:"ready",delivery:"pending",payment:"unpaid",status:"confirmed",revision:0,createdAt:"2026-10-29T08:00:00Z",items:[]};
test("Dispatch needs assignment, including failed-attempt retries",()=>{
  assert.throws(()=>nextState(base,"delivery","transit"),/COURIER_REQUIRED/);
  assert.throws(()=>nextState({...base,delivery:"failed"},"delivery","transit"),/COURIER_REQUIRED/);
  assert.equal(nextState({...base,courierId:"c"},"delivery","transit").payment,"unpaid");
});
test("Assignment locks after departure but failed orders may be reassigned",()=>{
  for(const delivery of ["pending","failed"]) assert.equal(canAssign({...base,delivery}),true);
  for(const delivery of ["transit","delivered"]) assert.equal(canAssign({...base,delivery}),false);
  assert.equal(canAssign({...base,status:"cancelled"}),false);
});
test("Manifest filters date, cancellation, assignment and status without dropping completed history",()=>{
  const rows=[base,{...base,id:"o2",courierId:"c",delivery:"delivered",time:"11:00"},{...base,id:"o3",courierId:"c",delivery:"failed"},{...base,id:"o4",status:"cancelled"},{...base,id:"o5",date:"2026-10-30"}];
  assert.deepEqual(deliveryList(rows,base.date,"all","all").map(o=>o.id),["o2","o1","o3"]);
  assert.deepEqual(deliveryList(rows,base.date,"c","open").map(o=>o.id),["o3"]);
  assert.deepEqual(deliveryList(rows,base.date,"unassigned","all").map(o=>o.id),["o1"]);
  assert.equal(deliveryList(rows,base.date,"c","delivered").length,1);
});
