from pathlib import Path
import sqlite3
copy=sqlite3.connect(':memory:')
copy.execute('PRAGMA foreign_keys=ON')
for migration in sorted(Path('drizzle').glob('*.sql')):
 if migration.name.startswith('0009'): break
 copy.executescript('BEGIN;'+migration.read_text()+'COMMIT;')
copy.executescript("""
 INSERT INTO ingredients (id,hu,ro,unit,pack_quantity,pack_price,min_stock,allergens,supplier) VALUES ('migration-i','Test','Test','g',100,50,0,'','Test');
 INSERT INTO suppliers (id,name,tax_id,address,email,phone,note) VALUES ('migration-s','Test','','','','','');
 INSERT INTO purchase_orders (id,supplier_id,supplier_name,supplier_tax_id,supplier_address,due,note,status,revision,created_at) VALUES ('migration-p','migration-s','Test','','','2026-10-29','','complete',0,'2026-10-29T00:00:00Z');
 INSERT INTO purchase_lines (id,purchase_id,ingredient_id,hu,ro,unit,quantity,received,pack_quantity,pack_price) VALUES ('migration-pl','migration-p','migration-i','Test','Test','g',100,100,100,50);
 INSERT INTO stock_lots (id,ingredient_id,batch,supplier,received,expires,quantity,remaining,total_cost,document,created_at,purchase_line_id) VALUES ('migration-l','migration-i','T','Test','2026-10-29','2026-11-01',100,80,50,'TEST','2026-10-29T00:00:00Z','migration-pl');
 INSERT INTO customers (id,name,address,phone,note) VALUES ('migration-c','Test','','','');
 INSERT INTO orders (id,customer_id,customer_name,address,phone,date,time,note,production,delivery,payment,status,revision,created_at) VALUES ('migration-o','migration-c','Test','','','2026-10-29','12:00','','cooking','pending','unpaid','confirmed',0,'2026-10-29T00:00:00Z');
 INSERT INTO stock_issues (id,order_id,recipe_snapshot,created_at,actor) VALUES ('migration-issue','migration-o','{}','2026-10-29T00:00:00Z','TEST');
 INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES ('migration-move','migration-l','migration-issue',-20,'issued','','2026-10-29T00:00:00Z');
""")
tables=['stock_lots','stock_moves','stock_issues','purchase_lines']
copy.row_factory=sqlite3.Row
before={t:[dict(r) for r in copy.execute('SELECT * FROM '+t)] for t in tables}
copy.executescript('BEGIN;'+Path('drizzle/0009_silent_champions.sql').read_text()+'COMMIT;')
assert not copy.execute('PRAGMA foreign_key_check').fetchall()
for t in tables:
 after=[dict(r) for r in copy.execute('SELECT * FROM '+t)]
 if t=='stock_lots':
  for row in after:
   assert row.pop('revision')==0
   assert row.pop('adjustment_total')==0
 assert after==before[t],t
print('PASS migration with foreign keys ON: original lots, moves, issues and purchase references preserved', {t:len(v) for t,v in before.items()})
copy.close()
