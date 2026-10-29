"""Change one fictional local product price for preview freshness tests."""
from pathlib import Path
import sqlite3, sys
root = (Path(__file__).resolve().parent.parent / '.wrangler/state/v3/d1').resolve()
matches = []
for file in root.rglob('*.sqlite'):
    if not file.resolve().is_relative_to(root):
        raise RuntimeError('Unexpected database path')
    with sqlite3.connect(file, timeout=20) as db:
        if db.execute("SELECT count(*) FROM sqlite_master WHERE name='recurring_templates'").fetchone()[0]:
            matches.append(file)
if len(matches) != 1:
    raise RuntimeError('Expected one local kitchen database')
price = int(sys.argv[2])
if not 0 <= price <= 1000000:
    raise RuntimeError('Invalid test price')
with sqlite3.connect(matches[0], timeout=20) as db:
    db.execute('UPDATE products SET price=? WHERE id=?', (price, sys.argv[1]))
