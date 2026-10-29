import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {countDelta,readyToPost} from '../src/modules/stocktake/domain.ts';
// @ts-ignore
import {nextStocktakeState} from '../src/modules/shared/domain.ts';
test('Counted zero differs from an uncounted lot; discrepancies need reasons',()=>{
 const line={expected:100,counted:null,note:''};
 assert.throws(()=>readyToPost([line] as any),/INCOMPLETE/);
 assert.throws(()=>readyToPost([{...line,counted:0}] as any),/NOTE/);
 assert.doesNotThrow(()=>readyToPost([{...line,counted:0,note:'Missing stock'}] as any));
 assert.doesNotThrow(()=>readyToPost([{...line,counted:100}] as any));
 assert.equal(countDelta(100,0),-100);assert.equal(countDelta(100,150),50);
 for(const value of [-1,0.5,NaN,10000001])assert.throws(()=>countDelta(100,value),/QUANTITY/);
});
test('Only drafts post or cancel; only posted counts reverse',()=>{
 assert.equal(nextStocktakeState('draft','post'),'posted');
 assert.equal(nextStocktakeState('draft','cancel'),'cancelled');
 assert.equal(nextStocktakeState('posted','reverse'),'reversed');
 for(const state of ['posted','reversed','cancelled'])assert.throws(()=>nextStocktakeState(state,'post'),/STATE/);
 assert.throws(()=>nextStocktakeState('draft','reverse'),/STATE/);
});
