"""Synthetic courier identities/bindings in the local preview database only."""
from pathlib import Path
import sqlite3,sys
root=(Path(__file__).resolve().parent.parent/'.wrangler/state/v3/d1').resolve();found=[]
for f in root.rglob('*.sqlite'):
 if not f.resolve().is_relative_to(root):raise RuntimeError('Unexpected path')
 with sqlite3.connect(f,timeout=20) as c:
  if c.execute("SELECT count(*) FROM sqlite_master WHERE name='members'").fetchone()[0]:found.append(f)
assert len(found)==1
A='c1111111-1111-4111-8111-111111111111';B='c2222222-2222-4222-8222-222222222222'
with sqlite3.connect(found[0],timeout=20) as db:
 action=sys.argv[1]
 for who in ['local_courier_owner','local_courier_target','local_courier_other']:
  db.execute("INSERT INTO members (user_id,name,email,role,revision,created_at) VALUES (?,?,?,'pending',0,'2026-10-29T00:00:00Z') ON CONFLICT(user_id) DO NOTHING",(who,who,who+'@sites.test'))
 if action=='admin':
  db.execute("UPDATE workspace_owners SET user_id='local_courier_owner' WHERE id=1")
  db.execute("UPDATE members SET role='admin' WHERE user_id='local_seedy'")
 elif action=='driver':
  db.execute("UPDATE workspace_owners SET user_id='local_courier_owner' WHERE id=1")
  db.execute("UPDATE members SET role='courier' WHERE user_id='local_seedy'")
  db.execute("UPDATE members SET role='courier' WHERE user_id='local_courier_other'")
  db.execute("UPDATE couriers SET user_id=NULL,binding_revision=binding_revision+1 WHERE user_id IN ('local_seedy','local_courier_other')")
  db.execute('UPDATE couriers SET user_id=?,binding_revision=binding_revision+1 WHERE id=?',('local_seedy',A))
  db.execute('UPDATE couriers SET user_id=?,binding_revision=binding_revision+1 WHERE id=?',('local_courier_other',B))
 elif action=='disabled':
  db.execute("UPDATE members SET role='disabled',revision=revision+1 WHERE user_id='local_seedy'")
 elif action=='reassign':
  db.execute("UPDATE orders SET courier_id=?,courier_name='Próba futár B',courier_phone='0000000000',revision=revision+1 WHERE id=? AND delivery IN ('pending','failed')",(B,sys.argv[2]))
 elif action=='restore':
  db.execute("UPDATE workspace_owners SET user_id='local_seedy' WHERE id=1")
  db.execute("UPDATE members SET role='pending' WHERE user_id='local_seedy'")
 else:raise RuntimeError('Unknown action')
