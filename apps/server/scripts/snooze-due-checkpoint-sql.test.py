"""Opt-in #130 repository SQL and0078 schema; simplified relational fixture.
Not a substitute for actual D1/current-policy/grant ledger native validation.
"""
import re, sqlite3, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
SOURCE=(ROOT/'apps/server/src/repositories/snooze-due-checkpoint.repository.ts').read_text()
SQL=re.findall(r'const SQL_\d = `([\s\S]*?)`;',SOURCE)
class Checkpoint(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.executescript('''CREATE TABLE budget_mutation_assertion(tenant_id TEXT PRIMARY KEY,accepted INTEGER CHECK(accepted=1));
  CREATE TABLE ticket_support_state(tenant_id TEXT,ticket_id TEXT,definition_id TEXT,revision INTEGER,snoozed_until TEXT,resurface_reason TEXT,changed_at TEXT,PRIMARY KEY(tenant_id,ticket_id));
  CREATE INDEX idx_ticket_support_state_snooze ON ticket_support_state(tenant_id,snoozed_until,ticket_id);
  CREATE TABLE support_state_events(tenant_id TEXT,id TEXT,ticket_id TEXT,definition_id TEXT,kind TEXT,actor_kind TEXT,actor_id TEXT,facts TEXT,PRIMARY KEY(tenant_id,id));''')
  self.db.executescript((ROOT/'apps/server/migrations/0067_snooze_scheduler.sql').read_text())
  self.db.executescript((ROOT/'apps/server/migrations/0078_snooze_due_checkpoint.sql').read_text())
 def tearDown(self): self.db.close()
 def seed(self,n=1):
  for i in range(n): self.db.execute('INSERT INTO ticket_support_state VALUES(?,?,?,?,?,?,?)',('a',str(i),'open',1,'2026-09-13T00:00:00.000Z',None,None))
  self.db.commit()
 def advance(self,n,g=0,step='3d2b49c9-49da-48f6-b23c-cefda4e23382'):
  p=dict(tenant='a',snapshot_n=n,snapshot_sentinel=n+1,expected_generation=g,step_id=step,due_through='2026-09-13T01:00:00.000Z',aggregate='agg',reservation='res',holder='holder',operation='op',fingerprint='fp')
  with self.db:
   self.db.execute(SQL[0],p);self.db.execute(SQL[1],p)
   self.assertEqual(self.db.execute('SELECT changes()').fetchone()[0],1)
   expected=self.db.execute("SELECT outcome='resurfaced' FROM snooze_due_checkpoint WHERE tenant_id='a'").fetchone()[0]
   self.db.execute(SQL[2],p);self.assertEqual(self.db.execute('SELECT changes()').fetchone()[0],expected)
   self.db.execute(SQL[3],p);self.assertEqual(self.db.execute('SELECT changes()').fetchone()[0],expected)
 def test_due_event_state_checkpoint_and_counter(self):
  self.seed();self.advance(1)
  self.assertEqual(self.db.execute('SELECT generation,outcome,original_revision FROM snooze_due_checkpoint').fetchone(),(1,'resurfaced',1))
  self.assertEqual(self.db.execute('SELECT snoozed_until,revision FROM ticket_support_state').fetchone(),(None,2))
  self.assertEqual(self.db.execute('SELECT active_snoozes FROM snooze_scheduler_tenants').fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM support_state_events').fetchone()[0],1)
 def test_empty_is_durable(self):
  self.advance(0)
  self.assertEqual(self.db.execute('SELECT outcome,ticket_id FROM snooze_due_checkpoint').fetchone(),('empty',None))
 def test_same_generation_cannot_repeat_event(self):
  self.seed();self.advance(1)
  with self.assertRaises(sqlite3.IntegrityError):self.advance(0)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM support_state_events').fetchone()[0],1)
 def test_next_generation_retains_single_checkpoint(self):
  self.seed(2);self.advance(2);self.advance(1,1,'4d2b49c9-49da-48f6-b23c-cefda4e23382')
  self.assertEqual(self.db.execute('SELECT COUNT(*),MAX(generation) FROM snooze_due_checkpoint').fetchone(),(1,2))
 def test_counter_mismatch_rolls_back_before_trigger(self):
  self.seed(2)
  with self.assertRaises(sqlite3.IntegrityError):self.advance(1)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM snooze_due_checkpoint').fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM support_state_events').fetchone()[0],0)
 def test_future_candidate_is_not_cleared(self):
  self.seed();self.db.execute("UPDATE ticket_support_state SET snoozed_until='2026-09-14T00:00:00.000Z'");self.db.commit();self.advance(1)
  self.assertEqual(self.db.execute('SELECT outcome FROM snooze_due_checkpoint').fetchone()[0],'empty')
if __name__=='__main__':unittest.main()
