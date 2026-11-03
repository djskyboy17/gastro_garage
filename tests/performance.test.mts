import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Native Node TypeScript
import {dateFormatter,numberFormatter} from '../src/modules/shared/format.ts';
// @ts-ignore Native Node TypeScript
import {groupRows} from '../src/modules/shared/collections.ts';
// @ts-ignore Native Node TypeScript
import {portalMenuDates} from '../src/modules/menu/domain.ts';

test('reused formatters preserve HU/RO currency, time zones and DST boundaries',()=>{
  for(const locale of ['hu-HU','ro-RO','sv-SE']){
    for(const timeZone of ['Europe/Bucharest','UTC']){
      const options={timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'} as const;
      for(const iso of ['2026-03-29T00:30Z','2026-03-29T01:30Z','2026-10-25T00:30Z','2026-10-25T01:30Z','2026-12-31T22:30Z']){
        const date=new Date(iso);
        assert.equal(dateFormatter(locale,options).format(date),new Intl.DateTimeFormat(locale,options).format(date));
        assert.deepEqual(dateFormatter(locale,options).formatToParts(date),new Intl.DateTimeFormat(locale,options).formatToParts(date));
      }
    }
    for(const bani of [0,1,99,2800,1234567]){
      const options={style:'currency',currency:'RON'} as const;
      assert.equal(numberFormatter(locale,options).format(bani/100),new Intl.NumberFormat(locale,options).format(bani/100));
    }
  }
});

test('grouped historical rows keep exact order, duplicates and unusual IDs without modifying input',()=>{
  const rows=Array.from({length:4000},(_,i)=>({id:String(i),parent:['__proto__','constructor','r1','r2'][i%4],snapshot:'Original name '+i}));
  const before=JSON.stringify(rows),groups=groupRows(rows,row=>row.parent);
  for(const parent of ['__proto__','constructor','r1','r2','missing']){
    assert.deepEqual(groups.get(parent)??[],rows.filter(row=>row.parent===parent));
  }
  assert.equal(JSON.stringify(rows),before);
  assert.deepEqual([...groupRows([],()=>'' )],[]);
});

test('portal board preserves remaining Monday–Saturday days across week and year boundaries',()=>{
  for(const [date,week] of [
    ['2026-11-02',['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07']],
    ['2026-11-07',['2026-11-07']],
    ['2026-11-08',['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14']],
    ['2026-12-31',['2026-12-31','2027-01-01','2027-01-02']],
  ] as const){
    const board=portalMenuDates(date);
    assert.deepEqual(board.week,week);
    assert.equal(board.dates.length,new Set(board.dates).size);
    assert.ok(board.dates.includes(date));
    assert.ok(board.dates.length<=7);
  }
});
