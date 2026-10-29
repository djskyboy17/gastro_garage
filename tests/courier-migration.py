from pathlib import Path
import sqlite3
copy=sqlite3.connect(':memory:');copy.execute('PRAGMA foreign_keys=ON')
for migration in sorted(Path('drizzle').glob('*.sql')):
 if migration.name.startswith('0011'):break
 copy.executescript('BEGIN;'+migration.read_text()+'COMMIT;')
copy.executescript("""
INSERT INTO members (user_id,name,email,role,revision,created_at) VALUES ('migration-user','Example','test@sites.test','pending',0,'2026-10-29T00:00:00Z');
INSERT INTO couriers (id,name,phone,vehicle,note,created_at) VALUES ('migration-courier','Example','','','','2026-10-29T00:00:00Z');
INSERT INTO customers (id,name,address,phone,note) VALUES ('migration-customer','Example','','','');
INSERT INTO orders (id,customer_id,customer_name,address,phone,date,time,note,production,delivery,payment,status,revision,created_at,courier_id) VALUES ('migration-order','migration-customer','Example','','','2026-10-29','12:00','','ready','pending','unpaid','confirmed',0,'2026-10-29T00:00:00Z','migration-courier');
""")
copy.row_factory=sqlite3.Row
tables=['members','couriers','orders'];before={t:[dict(r) for r in copy.execute('SELECT * FROM '+t)] for t in tables}
copy.executescript('BEGIN;'+Path('drizzle/0011_crazy_greymalkin.sql').read_text()+'COMMIT;')
assert not copy.execute('PRAGMA foreign_key_check').fetchall()
for t in tables:
 after=[dict(r) for r in copy.execute('SELECT * FROM '+t)]
 if t=='couriers':
  for row in after:
   assert row.pop('user_id') is None
   assert row.pop('binding_revision')==0
 assert after==before[t],t
copy.execute("UPDATE members SET role='courier' WHERE user_id='migration-user'")
copy.execute("UPDATE couriers SET user_id='migration-user' WHERE id='migration-courier'")
copy.execute("UPDATE members SET role='disabled' WHERE user_id='migration-user'")
assert copy.execute("SELECT user_id,binding_revision FROM couriers WHERE id='migration-courier'").fetchone()[:]==(None,1)
print('PASS courier migration: members, couriers, assigned orders preserved; courier role and automatic unlink on revocation work')
