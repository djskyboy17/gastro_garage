// Local synthetic benchmarks, never connects to D1 or Cloudflare.
// node --experimental-strip-types scripts/benchmark-cpu.mjs
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {drizzle} from 'drizzle-orm/d1';
import * as schema from '../db/schema.ts';
import {groupRows} from '../src/modules/shared/collections.ts';
function measure(fn){
  const samples=[];
  for(let i=0;i<110;i++){const start=performance.now();fn();if(i>=10)samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);
  return {medianMs:samples[50],p95Ms:samples[95]};
}
const parents=Array.from({length:1000},(_,i)=>({id:'order-'+i}));
const children=Array.from({length:10000},(_,i)=>({orderId:'order-'+(i%1000),snapshot:'Original '+i}));
const oldJoin=()=>parents.map(row=>({...row,items:children.filter(item=>item.orderId===row.id)}));
const newJoin=()=>{const groups=groupRows(children,item=>item.orderId);return parents.map(row=>({...row,items:groups.get(row.id)??[]}));};
assert.deepEqual(newJoin(),oldJoin());
console.log(JSON.stringify({
  note:'Warm local component costs in milliseconds; not Cloudflare request CPU or capacity guarantees.',
  tenDatabaseAdapters:{before:measure(()=>{for(let i=0;i<10;i++)drizzle({}, {schema});}),after:measure(()=>{for(let i=0;i<10;i++)drizzle({});})},
  join1000Orders10000Items:{before:measure(oldJoin),after:measure(newJoin)},
},null,2));
