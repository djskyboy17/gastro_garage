import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node test imports
import {canWrite,tabsFor,isMember,projectData,type Role} from "../src/modules/access/domain.ts";
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
test("Kitchen projections remove contacts, sales and operational modules without mutating source",()=>{
  const d=projectData(data,"kitchen");assert.equal(d.orders[0].customerName,"#123456");assert.equal(d.orders[0].phone,"");assert.equal(d.orders[0].deliveryFee,0);assert.equal(d.orders[0].fulfillmentPostalCode,"");assert.equal(d.orders[0].fulfillmentSnapshot,"");assert.equal(d.orders[0].fulfillmentMode,"pickup");assert.equal(d.orders[0].address,"");assert.equal(d.orders[0].items[0].price,0);assert.equal(d.orders[0].items[0].quantity,5);assert.equal(d.orders[0].note,"No peanuts");assert.equal(d.orders[0].courierId,null);assert.equal(d.orders[0].payment,"");assert.deepEqual(d.audit,[]);assert.deepEqual(d.customers,[]);assert.deepEqual(d.operations.ingredients,[]);assert.deepEqual(d.purchasing.suppliers,[]);assert.equal(data.orders[0].items[0].price,900);
});
test("Warehouse and dispatcher get different projections; owner keeps complete data",()=>{
  const w=projectData(data,"warehouse"),d=projectData(data,"dispatcher");assert.equal(w.operations.ingredients[0].packPrice,500);assert.equal(w.orders[0].phone,"");assert.equal(w.orders[0].note,"");assert.equal(w.purchasing.suppliers.length,1);assert.equal(w.logistics.couriers.length,0);assert.equal(d.orders[0].phone,"Private phone");assert.equal(d.operations.ingredients.length,0);assert.equal(d.purchasing.suppliers.length,0);assert.equal(d.audit.length,0);assert.equal(projectData(data,"owner"),data);
});
