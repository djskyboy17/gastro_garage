import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node test imports
import {publicProduct,publicOrder,validPortalSlot} from "../src/modules/portal/domain.ts";
// @ts-ignore Native Node test imports
import {nextState,kitchenSummary,type Order,type Product} from "../src/modules/shared/domain.ts";
// @ts-ignore Native Node test imports
import {deliveryList} from "../src/modules/delivery/domain.ts";
// @ts-ignore Native Node test imports
import {procurementPlan,emptyOperations} from "../src/modules/inventory/domain.ts";
const base:Order={id:"o",customerId:"private",customerName:"Example",address:"Example",phone:"0000000000",date:"2026-10-29",time:"12:00",note:"Customer note",status:"requested",production:"queued",delivery:"pending",payment:"unpaid",revision:0,createdAt:"2026-10-29T00:00:00Z",portalUserId:"secret-user",courierName:"Private courier",courierPhone:"Private phone",items:[{id:"i",orderId:"o",productId:"p",hu:"Étel",ro:"Preparat",allergens:"milk",price:1234,quantity:2,recipeId:"secret-recipe"}]};
test("Customer projection omits identity/master/recipe/courier data",()=>{
  const result=publicOrder(base);assert.equal(result.items[0].price,1234);assert.equal(result.status,"requested");for(const key of ["portalUserId","customerId","courierName","courierPhone"])assert.equal(key in result,false);assert.equal("recipeId" in result.items[0],false);assert.equal("productId" in result.items[0],false);
  const p=publicProduct({id:"p",hu:"Étel",ro:"Preparat",price:100,portion:200,descriptionHu:"",descriptionRo:"",category:"main",allergens:"milk",active:1,portalVisible:1,portalRevision:7} as Product);assert.equal("portalRevision" in p,false);assert.equal("active" in p,false);
});
test("Bucharest booking slots reject past, invalid and beyond-30-day values",()=>{
  const now=new Date("2026-10-29T10:00:00Z");assert.equal(validPortalSlot("2026-10-29","12:01",now),true);assert.equal(validPortalSlot("2026-10-29","12:00",now),false);assert.equal(validPortalSlot("2026-10-28","15:00",now),false);assert.equal(validPortalSlot("2026-11-28","12:00",now),true);assert.equal(validPortalSlot("2026-11-29","12:00",now),false);assert.equal(validPortalSlot("2026-02-30","12:00",now),false);assert.equal(validPortalSlot("2026-10-30","24:00",now),false);
});
test("Unconfirmed/rejected requests never enter kitchen or delivery plans",()=>{
  const confirmed={...base,id:"confirmed",status:"confirmed"};const rejected={...base,id:"rejected",status:"rejected"};assert.equal(kitchenSummary([base,rejected,confirmed])[0].quantity,2);assert.deepEqual(deliveryList([base,rejected,confirmed],base.date,"all","all").map(o=>o.id),["confirmed"]);
  assert.deepEqual(procurementPlan([base,rejected],emptyOperations,base.date).missing,[]);
});
test("Only requested status review/cancellation may precede normal operations",()=>{
  for(const field of ["production","payment","delivery"])assert.throws(()=>nextState(base,field,"paid"),/ORDER_NOT_CONFIRMED/);
  assert.equal(nextState(base,"status","confirmed").status,"confirmed");assert.equal(nextState(base,"status","rejected").status,"rejected");assert.equal(nextState(base,"status","cancelled").status,"cancelled");assert.throws(()=>nextState({...base,status:"rejected"},"status","confirmed"),/REJECTED/);
});
