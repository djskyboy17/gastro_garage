import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node test imports
import {matchingDates,validDate,recurringOrderId,type RecurringContent} from "../src/modules/recurring/domain.ts";
// @ts-ignore Native Node test imports
import {canWrite,projectData} from "../src/modules/access/domain.ts";
// @ts-ignore Native Node test imports
import {orderCode} from "../src/modules/shared/domain.ts";
const template:RecurringContent={start:"2026-10-01",end:"2026-11-30",time:"12:00",weekdays:[1,2,3,4,5],excludedDates:["2026-10-26"],note:"",items:[]};
test("Weekly recurrence spans DST without skipping or duplicating local dates",()=>{
  assert.deepEqual(matchingDates(template,"2026-10-23","2026-10-28"),["2026-10-23","2026-10-27","2026-10-28"]);
});
test("Inclusive template bounds and ISO Sunday handling are explicit",()=>{
  assert.deepEqual(matchingDates({...template,start:"2026-10-25",end:"2026-10-26",weekdays:[7],excludedDates:[]},"2026-10-24","2026-10-27"),["2026-10-25"]);
  assert.deepEqual(matchingDates({...template,start:"2026-10-27",end:"2026-10-27"},"2026-10-26","2026-10-28"),["2026-10-27"]);
});
test("Real dates and a maximum 31-day generation window are enforced",()=>{
  assert.equal(validDate("2028-02-29"),true);assert.equal(validDate("2026-02-29"),false);assert.equal(validDate("2026-13-01"),false);
  assert.equal(matchingDates({...template,weekdays:[1,2,3,4,5,6,7],excludedDates:[]},"2026-10-01","2026-10-31").length,31);
  for(const [from,to] of [["2026-10-01","2026-11-01"],["2026-10-02","2026-10-01"],["invalid","2026-10-01"]])assert.throws(()=>matchingDates(template,from,to),/RECURRING_RANGE/);
});
test("Occurrence identity is stable and includes the full template and date",()=>{
  assert.equal(recurringOrderId("a","2026-10-29"),"recurring:a:2026-10-29");assert.notEqual(recurringOrderId("a","2026-10-29"),recurringOrderId("b","2026-10-29"));
});
test("Display codes distinguish recurring templates on the same day",()=>{
  const a=orderCode(recurringOrderId("aaaaaaaa-0000-4000-8000-000000000000","2026-10-29"));
  const b=orderCode(recurringOrderId("bbbbbbbb-0000-4000-8000-000000000000","2026-10-29"));
  assert.equal(a,"R-AAAAAA-261029");assert.notEqual(a,b);assert.equal(orderCode("ordinary-abcdef"),"ABCDEF");
});
test("Only supervisors and dispatcher can manage/generate recurring orders",()=>{
  for(const role of ["owner","admin","dispatcher"] as const)for(const path of ["templates","preview","generate"])assert.equal(canWrite(role,"/api/recurring/"+path,{}),true);
  for(const role of ["kitchen","warehouse","pending","disabled"] as const)assert.equal(canWrite(role,"/api/recurring/generate",{}),false);
});
