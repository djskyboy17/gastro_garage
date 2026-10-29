"""Local preview role fixtures only. Never points at the hosted database."""
import sqlite3, sys
from pathlib import Path
root = (Path(__file__).resolve().parent.parent / '.wrangler/state/v3/d1').resolve()
matches = []
for file in root.rglob('*.sqlite'):
    if not file.resolve().is_relative_to(root):
        raise RuntimeError('Unexpected database path')
    db = sqlite3.connect(file, timeout=20)
    if db.execute("SELECT count(*) FROM sqlite_master WHERE name='members'").fetchone()[0]:
        matches.append(file)
    db.close()
if len(matches) != 1:
    raise RuntimeError('Expected one local kitchen database')
with sqlite3.connect(matches[0], timeout=20) as db:
    action = sys.argv[1]
    if action == 'restore':
        db.execute("UPDATE workspace_owners SET user_id='local_seedy' WHERE id=1")
        db.execute("UPDATE members SET role='pending' WHERE user_id='local_seedy'")
    elif action in ('pending','disabled','admin','kitchen','warehouse','dispatcher'):
        db.execute("UPDATE workspace_owners SET user_id='local_access_owner' WHERE id=1")
        db.execute("UPDATE members SET role=? WHERE user_id='local_seedy'",(action,))
        for who in ('local_access_owner','local_access_target'):
            db.execute("INSERT INTO members (user_id,name,email,role,revision,created_at) VALUES (?,?,'fixture@sites.test','pending',0,'2026-10-29T00:00:00Z') ON CONFLICT(user_id) DO NOTHING",(who,who))
    else:
        raise RuntimeError('Unknown fixture action')
