import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Native Node type stripping.
import { orderDocumentTone } from '../src/modules/shared/domain.ts';
const ready = { status:'confirmed', production:'ready', delivery:'pending' };
test('Document colors require confirmed live evidence, never a prepared job or missing data', () => {
  assert.equal(orderDocumentTone(ready, null),'neutral');
  assert.equal(orderDocumentTone(ready,{deferred:false,issued:false,uncertain:false}),'orange');
  assert.equal(orderDocumentTone(ready,{deferred:false,issued:true,uncertain:false}),'yellow');
  assert.equal(orderDocumentTone(ready,{deferred:true,issued:false,uncertain:false}),'yellow');
  assert.equal(orderDocumentTone(ready,{deferred:true,issued:true,uncertain:true}),'orange');
});
test('Delivery, cancellation and failed delivery take precedence over document colors', () => {
  assert.equal(orderDocumentTone({...ready,delivery:'transit'},null),'blue');
  assert.equal(orderDocumentTone({...ready,delivery:'delivered'},null),'green');
  assert.equal(orderDocumentTone({...ready,status:'cancelled'},null),'neutral');
  assert.equal(orderDocumentTone({...ready,delivery:'failed'},null),'neutral');
  assert.equal(orderDocumentTone({...ready,production:'cooking'},null),'neutral');
});
