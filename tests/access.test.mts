import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node test imports
import {canWrite,tabsFor,isMember,projectData,settingsTabs,isSettingsTab,assignableRoles,type Role} from "../src/modules/access/domain.ts";
// @ts-ignore Native Node test imports
import type {AppData} from "../src/modules/shared/domain.ts";
test("Every role denies unknown paths and inactive roles deny business writes",()=>{
  for(const role of ["owner","admin","kitchen","warehouse","dispatcher","pending","disabled"] as Role[]){
    assert.equal(canWrite(role,"/api/new-module",{}),false);
    if(!isMember(role)){assert.deepEqual(tabsFor(role),[]);assert.equal(canWrite(role,"/api/orders",{}),false);}
  }
  assert.equal(isMember("forged" as Role),false);
});
test("Production, sales and inventory write boundaries cannot be crossed",()=>{
  assert.equal(canWrite("kitchen","/api/orders/state",{field:"production"}),true);
  assert.equal(canWrite("kitchen","/api/orders/state",{field:"payment"}),false);
  assert.equal(canWrite("warehouse","/api/operations/receive",{}),true);
  assert.equal(canWrite("warehouse","/api/operations/demo",{}),false);
  assert.equal(canWrite("warehouse","/api/customers",{}),false);
  assert.equal(canWrite("dispatcher","/api/orders/state",{field:"delivery"}),true);
  assert.equal(canWrite("dispatcher","/api/orders/state",{field:"production"}),false);
  assert.equal(canWrite("dispatcher","/api/operations/recipes",{}),false);
  assert.equal(canWrite("dispatcher","/api/access/role",{}),false);
  assert.equal(canWrite("admin","/api/access/role",{}),true);
});
const data={products:[{id:"p",price:900}],customers:[{id:"c",phone:"private"}],orders:[{deliveryFee:750,fulfillmentPostalCode:"123456",fulfillmentSnapshot:"private-address-snapshot",fulfillmentMode:"pickup",status:"confirmed",id:"order123456",customerId:"c",customerName:"Private customer",address:"Private address",phone:"Private phone",note:"No peanuts",payment:"paid",courierId:"courier",courierName:"Private courier",courierPhone:"Private courier phone",items:[{quantity:5,allergens:"peanut",price:900}]}],audit:[{detail:"private"}],operations:{ingredients:[{packPrice:500}],recipes:[],lots:[],issues:[],moves:[]},purchasing:{suppliers:[{name:"Supplier"}],orders:[],events:[]},logistics:{couriers:[{name:"Courier"}],events:[]}} as unknown as AppData;
test("Kitchen (v41) sees overview orders, stock and purchasing, but not the customer register or audit, without mutating source",()=>{
  for(const role of ["kitchen","warehouse"] as Role[]){
    const d=projectData(data,role);
    assert.equal(d.orders[0].customerName,"Private customer",role);assert.equal(d.orders[0].items[0].price,900);assert.equal(d.orders[0].deliveryFee,750);assert.equal(d.orders[0].payment,"paid");assert.equal(d.orders[0].note,"No peanuts");
    assert.equal(d.operations.ingredients[0].packPrice,500);assert.equal(d.purchasing.suppliers.length,1);assert.equal(d.logistics.couriers.length,1);
    assert.deepEqual(d.customers,[]);assert.deepEqual(d.audit,[]);
  }
  assert.equal(data.orders[0].items[0].price,900);
});
test("Dispatcher gets sales data but no stock; owner keeps complete data",()=>{
  const d=projectData(data,"dispatcher");assert.equal(d.orders[0].phone,"Private phone");assert.equal(d.operations.ingredients.length,0);assert.equal(d.purchasing.suppliers.length,0);assert.equal(d.audit.length,0);assert.equal(projectData(data,"owner"),data);
});
test("No separate warehouse role: kitchen does stock and purchasing; warehouse can no longer be assigned",()=>{
  assert.ok(!(assignableRoles as readonly string[]).includes("warehouse"));
  for(const role of ["kitchen","warehouse"] as Role[]){
    assert.deepEqual(tabsFor(role),["overview","orders","kitchen","packing","delivery","recipes","inventory","stocktake","procurement","safety","settings"]);
    assert.equal(canWrite(role,"/api/operations/receive",{}),true);assert.equal(canWrite(role,"/api/purchasing/create",{}),true);
    assert.equal(canWrite(role,"/api/stocktake/save",{}),true);assert.equal(canWrite(role,"/api/stocktake/post",{}),false);
    assert.equal(canWrite(role,"/api/orders/state",{field:"production"}),true);assert.equal(canWrite(role,"/api/orders/state",{field:"payment"}),false);
    assert.equal(canWrite(role,"/api/orders",{}),false);assert.equal(canWrite(role,"/api/delivery/assign",{}),false);assert.equal(canWrite(role,"/api/operations/demo",{}),false);
  }
});
test("Beállítások: a ritkán használt nézetek a Beállítások alá kerülnek, a jogosultság nem változik", () => {
  for (const role of ["owner", "admin", "dispatcher", "kitchen", "warehouse"] as Role[]) {
    const tabs = tabsFor(role);
    assert.ok(tabs.includes("settings"), role);
    assert.ok(!tabs.includes("roadmap"), role);
  }
  assert.deepEqual(settingsTabs.filter((t) => tabsFor("kitchen").includes(t)), ["safety", "stocktake"]);
  assert.deepEqual(settingsTabs.filter((t) => tabsFor("dispatcher").includes(t)), ["fulfillment", "portal"]);
  assert.deepEqual(settingsTabs.filter((t) => tabsFor("owner").includes(t)), ["safety", "fulfillment", "portal", "stocktake", "labels", "access", "audit"]);
  // Címkeadatokat csak tulajdonos és admin ment (v32).
  for (const role of ["owner", "admin"] as const) assert.equal(canWrite(role, "/api/labels/settings", {}), true);
  for (const role of ["dispatcher", "kitchen", "warehouse", "courier"] as const) assert.equal(canWrite(role, "/api/labels/settings", {}), false);
  // Napi beosztás és átvételre váltás: admin és diszpécser (v36).
  for (const path of ["/api/delivery/shift", "/api/delivery/to-pickup"]) {
    for (const role of ["owner", "admin", "dispatcher"] as const) assert.equal(canWrite(role, path, {}), true, role + path);
    for (const role of ["kitchen", "warehouse", "courier", "pending"] as const) assert.equal(canWrite(role, path, {}), false, role + path);
  }
  assert.ok(isSettingsTab("audit") && !isSettingsTab("orders"));
});
test("Only the kitchen and administrators can mark dishes ready", () => {
  assert.equal(canWrite("kitchen", "/api/kitchen/ready", {}), true);
  assert.equal(canWrite("admin", "/api/kitchen/ready", {}), true);
  assert.equal(canWrite("dispatcher", "/api/kitchen/ready", {}), false);
  assert.equal(canWrite("warehouse", "/api/kitchen/ready", {}), true); // v41: a régi raktáros fiók konyhaként működik
  assert.equal(canWrite("courier", "/api/kitchen/ready", {}), false);
});
