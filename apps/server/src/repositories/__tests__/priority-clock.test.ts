import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectPriorityClock, type PriorityClockRow } from '../priority-clock.repository';

const migrationDirectory = join(__dirname, '../../../migrations');
function apply(db: Database.Database, from = 1, through = 80) {
  for (const name of readdirSync(migrationDirectory).filter(n => n.endsWith('.sql') && Number(n.slice(0, 4)) >= from && Number(n.slice(0, 4)) <= through).sort()) {
    db.transaction(() => db.exec(readFileSync(join(migrationDirectory, name), 'utf8')))();
  }
}
function dbWithClock() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  apply(db);
  return db;
}
function clock(db: Database.Database, tenant: string, ticket: string): PriorityClockRow {
  return db.prepare(`SELECT c.ticket_id,c.started_at,c.active_since,c.accrued_active_ms,c.stop_reason,
    c.last_support_state_revision,c.revision,c.updated_at,t.contract_sla_tier,t.criticality_tier
    FROM ticket_priority_clocks c JOIN tickets t ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id
    WHERE c.tenant_id=? AND c.ticket_id=?`).get(tenant,ticket) as PriorityClockRow;
}
function ticket(db: Database.Database, tenant: string, id: string, status = 'open') {
  db.prepare(`INSERT INTO tickets
    (tenant_id,id,subject,status,customer_email,source,created_at,intake_received_at,
      priority_category,priority_scope,priority_regulatory_officer_on_site,priority_vip_blocked,
      priority_hard_deadline,priority_score,contract_sla_tier,criticality_tier)
    VALUES (?,?,?,?,'customer@example.invalid','dashboard','2026-09-20 10:00:00','2026-09-20T10:00:00.000Z',
      'information-requests','isolated',0,0,0,1,'alpha',4)`)
    .run(tenant,id,id,status);
}
function state(db: Database.Database, tenant: string, id: string, definition: string, waiting: string | null, at: string) {
  db.prepare(`UPDATE ticket_support_state SET definition_id=?,waiting_reason=?,changed_at=?,revision=revision+1
    WHERE tenant_id=? AND ticket_id=?`).run(definition,waiting,at,tenant,id);
}

describe('priority clock database lifecycle', () => {
  it('does not invent starts for historical records, but initializes newly ingested tickets', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      apply(db,1,79);
      ticket(db,'tenant-A','historic');
      apply(db,80,80);
      expect(db.prepare("SELECT 1 FROM ticket_priority_clocks WHERE ticket_id='historic'").get()).toBeUndefined();
      ticket(db,'tenant-A','new');
      ticket(db,'tenant-A','already-resolved','resolved');
      ticket(db,'tenant-A','already-pending','pending');
      expect(clock(db,'tenant-A','new')).toMatchObject({
        started_at:'2026-09-20T10:00:00.000Z',active_since:'2026-09-20T10:00:00.000Z',accrued_active_ms:0,stop_reason:null,
      });
      expect(clock(db,'tenant-A','already-resolved')).toMatchObject({
        active_since:null,accrued_active_ms:0,stop_reason:'resolved',
      });
      expect(clock(db,'tenant-A','already-pending')).toMatchObject({
        active_since:null,accrued_active_ms:0,stop_reason:'waiting',
      });
      expect(projectPriorityClock(clock(db,'tenant-A','already-resolved'),Date.parse('2026-09-21T00:00:00Z'))?.timeRemainingHours).toBe(1);
      expect(projectPriorityClock(clock(db,'tenant-A','already-pending'),Date.parse('2026-09-21T00:00:00Z'))?.timeRemainingHours).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });

  it('freezes waiting and resolved periods, retaining active time debt on reopen', () => {
    const db = dbWithClock();
    try {
      ticket(db,'tenant-A','case');
      state(db,'tenant-A','case','legacy-pending','awaiting customer','2026-09-20T10:30:00.000Z');
      expect(projectPriorityClock(clock(db,'tenant-A','case'),Date.parse('2026-09-20T12:00:00Z'))).toMatchObject({
        elapsedActiveMs:1_800_000,timeRemainingHours:0.5,paused:true,stopReason:'waiting',
      });
      state(db,'tenant-A','case','legacy-open',null,'2026-09-20T12:30:00.000Z');
      state(db,'tenant-A','case','legacy-resolved',null,'2026-09-20T13:00:00.000Z');
      expect(projectPriorityClock(clock(db,'tenant-A','case'),Date.parse('2026-09-20T14:00:00Z'))?.elapsedActiveMs).toBe(3_600_000);
      state(db,'tenant-A','case','legacy-open',null,'2026-09-20T15:00:00.000Z');
      expect(projectPriorityClock(clock(db,'tenant-A','case'),Date.parse('2026-09-20T15:15:00Z'))).toMatchObject({
        elapsedActiveMs:4_500_000,timeRemainingHours:-0.25,paused:false,stopReason:null,
      });
      expect(clock(db,'tenant-A','case')).toMatchObject({last_support_state_revision:5,revision:5});
    } finally { db.close(); }
  });

  it('isolates tenants and ignores stale or same-revision state writes', () => {
    const db = dbWithClock();
    try {
      ticket(db,'tenant-A','same');
      ticket(db,'tenant-B','same');
      state(db,'tenant-A','same','legacy-pending','waiting','2026-09-20T10:30:00.000Z');
      expect(clock(db,'tenant-B','same')).toMatchObject({accrued_active_ms:0,stop_reason:null,revision:1});
      state(db,'tenant-B','same','legacy-pending',null,'2026-09-20T10:15:00.000Z');
      expect(clock(db,'tenant-B','same')).toMatchObject({accrued_active_ms:900_000,stop_reason:'waiting',revision:2});
      // A replayed row at the same support-state revision cannot account twice.
      db.prepare(`UPDATE ticket_support_state SET changed_at='2026-09-20T11:00:00.000Z'
        WHERE tenant_id='tenant-A' AND ticket_id='same'`).run();
      expect(clock(db,'tenant-A','same')).toMatchObject({accrued_active_ms:1_800_000,revision:2});
      db.prepare(`UPDATE ticket_support_state SET definition_id='legacy-resolved',revision=1,
        changed_at='2026-09-20T12:00:00.000Z' WHERE tenant_id='tenant-A' AND ticket_id='same'`).run();
      expect(clock(db,'tenant-A','same')).toMatchObject({accrued_active_ms:1_800_000,revision:2});
    } finally { db.close(); }
  });
});
