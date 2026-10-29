"""Synthetic second customer and repeatable local-only rate-limit setup."""
from pathlib import Path
import sqlite3
root = (Path(__file__).resolve().parent.parent / '.wrangler/state/v3/d1').resolve()
matches = []
for file in root.rglob('*.sqlite'):
    if not file.resolve().is_relative_to(root):
        raise RuntimeError('Unexpected database path')
    with sqlite3.connect(file, timeout=20) as db:
        if db.execute("SELECT count(*) FROM sqlite_master WHERE name='portal_profiles'").fetchone()[0]:
            matches.append(file)
if len(matches) != 1:
    raise RuntimeError('Expected one local kitchen database')
with sqlite3.connect(matches[0], timeout=20) as db:
    db.execute("UPDATE orders SET status='cancelled',revision=revision+1 WHERE portal_user_id='local_seedy' AND status='requested'")
    db.execute("UPDATE portal_submissions SET created_at='2000-01-01T00:00:00Z' WHERE user_id='local_seedy'")
    db.execute("INSERT INTO customers (id,name,address,phone,note) VALUES ('local_portal_other_customer','OTHER PRIVATE CUSTOMER','OTHER PRIVATE ADDRESS','0000000000','') ON CONFLICT(id) DO NOTHING")
    db.execute("INSERT INTO portal_profiles (user_id,customer_id,active,revision,created_at) VALUES ('local_portal_other','local_portal_other_customer',1,0,'2026-10-29T00:00:00Z') ON CONFLICT(user_id) DO NOTHING")
    db.execute("INSERT INTO orders (id,customer_id,customer_name,address,phone,date,time,note,production,delivery,payment,status,revision,created_at,portal_user_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','local_portal_other_customer','OTHER PRIVATE CUSTOMER','OTHER PRIVATE ADDRESS','0000000000','2099-01-01','12:00','OTHER PRIVATE NOTE','queued','pending','unpaid','requested',0,'2026-10-29T00:00:00Z','local_portal_other') ON CONFLICT(id) DO NOTHING")
