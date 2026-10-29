from pathlib import Path
import sqlite3

db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
for m in sorted(Path('drizzle').glob('*.sql')):
    if m.name.startswith('0012'): break
    db.executescript('BEGIN;'+m.read_text(encoding='utf-8')+'COMMIT;')
db.execute("INSERT INTO customers VALUES ('c','Sample','Saved address','','')")
for state in ['pending','transit','delivered']:
    db.execute("INSERT INTO orders(id,customer_id,customer_name,address,phone,date,time,note,production,delivery,payment,status,revision,created_at) VALUES (?,'c','Saved name','Saved address','','2026-10-29','12:00','','ready',?,'unpaid','confirmed',7,'2026-10-29T00:00:00Z')",(state,state))
db.commit();db.row_factory=sqlite3.Row
before={r['id']:dict(r) for r in db.execute('SELECT * FROM orders')}
db.executescript('BEGIN;'+Path('drizzle/0012_amazing_selene.sql').read_text()+'COMMIT;')
for row in db.execute('SELECT * FROM orders'):
    row=dict(row);assert row.pop('packing_items')=='[]';assert row.pop('packing_ready')==0;assert row.pop('packing_checked_at')=='';assert row==before[row['id']]
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print('PASS additive packing migration: pending/transit/delivered history preserved, no false verification, foreign keys valid')
