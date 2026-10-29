"""Read-only SQL check of the last local cross-module workflow scenario."""
from pathlib import Path
import json, sqlite3

project = Path(__file__).resolve().parent.parent
context = json.loads((project / 'work/workflow-context.json').read_text())
root = (project / '.wrangler/state/v3/d1').resolve()
matches = []
for file in root.rglob('*.sqlite'):
    assert file.resolve().is_relative_to(root)
    with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True, timeout=20) as db:
        if db.execute("SELECT count(*) FROM sqlite_master WHERE name='stock_issues'").fetchone()[0]:
            matches.append(file)
assert len(matches) == 1
with sqlite3.connect(matches[0].as_uri() + '?mode=ro', uri=True, timeout=20) as db:
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    row = db.execute('SELECT status,production,delivery,payment,address FROM orders WHERE id=?', (context['orderId'],)).fetchone()
    assert row == ('confirmed', 'ready', 'delivered', 'unpaid', 'Kitalált teszt utca 12'), row
    issue = db.execute('SELECT id FROM stock_issues WHERE order_id=?', (context['orderId'],)).fetchall()
    assert len(issue) == 1
    assert db.execute('SELECT sum(quantity) FROM stock_moves WHERE issue_id=?', issue[0]).fetchone()[0] == -200
    lot = db.execute('SELECT remaining,purchase_line_id FROM stock_lots WHERE id=?', (context['receiptId'],)).fetchone()
    assert lot[0] == 800 and lot[1]
    assert db.execute('SELECT recipe_id,quantity,price,allergens FROM order_items WHERE order_id=?', (context['orderId'],)).fetchone() == (context['recipeId'], 2, 2500, 'gluten')
print('PASS SQL persistence: foreign keys, order snapshots/states, supplier-linked lot, exact single 200g issue, 800g remaining')
