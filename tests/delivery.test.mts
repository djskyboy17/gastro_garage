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

test("Daily roster: only couriers on shift that day, least loaded suggested first", async () => {
  // @ts-ignore Node native type stripping
  const { shiftCouriers, suggestCourier } = await import("../src/modules/delivery/domain.ts");
  const list = [{ id: "a", name: "Anna" }, { id: "b", name: "Béla" }, { id: "c", name: "Csaba" }];
  const shifts = [{ date: "2026-11-02", courierId: "b" }, { date: "2026-11-02", courierId: "c" }, { date: "2026-11-03", courierId: "a" }];
  const on = shiftCouriers(list, shifts, "2026-11-02");
  assert.deepEqual(on.map((c: { id: string }) => c.id), ["b", "c"]);
  assert.deepEqual(shiftCouriers(list, shifts, "2026-11-04"), []);
  const orders = [
    { date: "2026-11-02", courierId: "b", delivery: "pending", status: "confirmed" },
    { date: "2026-11-02", courierId: "b", delivery: "transit", status: "confirmed" },
    { date: "2026-11-02", courierId: "c", delivery: "delivered", status: "confirmed" },
    { date: "2026-11-01", courierId: "c", delivery: "pending", status: "confirmed" },
  ];
  assert.equal(suggestCourier(on, orders, "2026-11-02"), "c");
  assert.equal(suggestCourier([], orders, "2026-11-02"), null);
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
