import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node test imports
import {canAssign,deliveryList} from "../src/modules/delivery/domain.ts";
// @ts-ignore Native Node test imports
import {nextState,type Order} from "../src/modules/shared/domain.ts";
const base: Order = {packingReady:1,id:"o1",customerId:"c1",customerName:"Example",address:"Example",phone:"",date:"2026-10-29",time:"12:00",note:"",production:"ready",delivery:"pending",payment:"unpaid",status:"confirmed",revision:0,createdAt:"2026-10-29T08:00:00Z",items:[]};
test("v51: dispatch needs no courier assignment (single courier), including failed-attempt retries",()=>{
  assert.equal(nextState(base,"delivery","transit").delivery,"transit");
  assert.equal(nextState({...base,delivery:"failed"},"delivery","transit").delivery,"transit");
  assert.equal(nextState(base,"delivery","transit").payment,"unpaid");
});
test("Assignment locks after departure but failed orders may be reassigned",()=>{
  for(const delivery of ["pending","failed"]) assert.equal(canAssign({...base,delivery}),true);
  for(const delivery of ["transit","delivered"]) assert.equal(canAssign({...base,delivery}),false);
  assert.equal(canAssign({...base,status:"cancelled"}),false);
});
test("Manifest filters date, cancellation and status without dropping completed history",()=>{
  const rows=[base,{...base,id:"o2",delivery:"delivered",time:"11:00"},{...base,id:"o3",delivery:"failed"},{...base,id:"o4",status:"cancelled"},{...base,id:"o5",date:"2026-10-30"}];
  assert.deepEqual(deliveryList(rows,base.date,"all").map(o=>o.id),["o2","o1","o3"]);
  assert.deepEqual(deliveryList(rows,base.date,"open").map(o=>o.id),["o1","o3"]);
  assert.equal(deliveryList(rows,base.date,"delivered").length,1);
});

test("Switching to pickup keeps or removes the fee as chosen and uses the pickup address", async () => {
  // @ts-ignore Node native type stripping
  const { pickupSwitch } = await import("../src/modules/delivery/domain.ts");
  const snap = { mode: "delivery", slotId: "s1", start: "11:00", end: "13:00", zoneHu: "Kézdi", zoneRo: "Tg", postalCode: "525400", addressHu: "", addressRo: "", fee: 5000 };
  const policy = { pickupHu: "Nyújtód, Fő út 1", pickupRo: "Lunca, Str. Principală 1" };
  const keep = pickupSwitch(snap, policy, 5000, false);
  assert.equal(keep.fee, 5000);
  assert.equal(keep.snapshot.mode, "pickup");
  assert.equal(keep.snapshot.start, "11:00");
  assert.equal(keep.snapshot.postalCode, "");
  assert.equal(keep.address, "Nyújtód, Fő út 1 / Lunca, Str. Principală 1");
  const drop = pickupSwitch(snap, policy, 5000, true);
  assert.equal(drop.fee, 0);
  assert.equal(drop.snapshot.fee, 0);
});
