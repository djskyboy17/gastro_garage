import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {cutoffInstant,kitchenWallTime,validDay,addDays,remaining} from '../src/modules/menu/domain.ts';
test('Bucharest deadlines use date-specific summer and winter offsets',()=>{
 assert.equal(cutoffInstant('2026-07-01T09:00'),'2026-07-01T06:00:00.000Z');
 assert.equal(cutoffInstant('2026-12-01T09:00'),'2026-12-01T07:00:00.000Z');
 assert.equal(kitchenWallTime(new Date('2026-12-01T07:00:00Z')),'2026-12-01T09:00');
});
test('invalid dates and ambiguous or nonexistent DST times fail closed',()=>{
 assert.equal(cutoffInstant('2026-03-29T03:30'),null);
 assert.equal(cutoffInstant('2026-10-25T03:30'),null);
 assert.equal(cutoffInstant('2026-02-30T12:00'),null);
 assert.equal(cutoffInstant('2026-12-01T24:00'),null);
 assert.equal(validDay('2026-02-29'),false);
 assert.equal(addDays('2026-12-31',1),'2027-01-01');
 assert.equal(remaining(5,7),0);
});
