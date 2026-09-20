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
function snooze(db: Database.Database, tenant: string, id: string, until: string | null,
  reason: 'manual' | 'due' | 'customer_reply' | null, at: string) {
  db.prepare(`UPDATE ticket_support_state SET snoozed_until=?,resurface_reason=?,changed_at=?,revision=revision+1
    WHERE tenant_id=? AND ticket_id=?`).run(until,reason,at,tenant,id);
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
        active_since:'2026-09-20T10:00:00.000Z',accrued_active_ms:0,stop_reason:null,
      });
      expect(projectPriorityClock(clock(db,'tenant-A','already-resolved'),Date.parse('2026-09-21T00:00:00Z'))?.timeRemainingHours).toBe(1);
      expect(projectPriorityClock(clock(db,'tenant-A','already-pending'),Date.parse('2026-09-21T00:00:00Z'))?.timeRemainingHours).toBe(-13);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });

  it('accrues pending time without a waiting reason and pauses only when the reason is set', () => {
    const db = dbWithClock();
    try {
      ticket(db,'tenant-A','unexplained-pending','pending');
      state(db,'tenant-A','unexplained-pending','legacy-pending',null,'2026-09-20T10:15:00.000Z');
      expect(clock(db,'tenant-A','unexplained-pending')).toMatchObject({
        active_since:'2026-09-20T10:00:00.000Z',accrued_active_ms:0,stop_reason:null,
      });
      expect(projectPriorityClock(clock(db,'tenant-A','unexplained-pending'),Date.parse('2026-09-20T10:30:00Z'))).toMatchObject({
        elapsedActiveMs:1_800_000,timeRemainingHours:0.5,paused:false,
      });
      state(db,'tenant-A','unexplained-pending','legacy-pending','awaiting customer','2026-09-20T10:30:00.000Z');
      expect(clock(db,'tenant-A','unexplained-pending')).toMatchObject({
        active_since:null,accrued_active_ms:1_800_000,stop_reason:'waiting',
      });
      expect(projectPriorityClock(clock(db,'tenant-A','unexplained-pending'),Date.parse('2026-09-20T11:00:00Z'))).toMatchObject({
        elapsedActiveMs:1_800_000,timeRemainingHours:0.5,paused:true,
      });
      state(db,'tenant-A','unexplained-pending','legacy-pending',null,'2026-09-20T11:00:00.000Z');
      expect(projectPriorityClock(clock(db,'tenant-A','unexplained-pending'),Date.parse('2026-09-20T11:15:00Z'))).toMatchObject({
        elapsedActiveMs:2_700_000,timeRemainingHours:0.25,paused:false,
      });
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

  it('freezes a snooze, ignores deadline edits while paused, and resumes the same debt on due and manual wake', () => {
    const db = dbWithClock();
    try {
      ticket(db,'tenant-A','snooze-debt');
      snooze(db,'tenant-A','snooze-debt','2026-09-20T11:00:00.000Z',null,'2026-09-20T10:20:00.000Z');
      const paused = projectPriorityClock(clock(db,'tenant-A','snooze-debt'),Date.parse('2026-09-20T10:50:00Z'));
      expect(paused).toMatchObject({
        elapsedActiveMs:1_200_000,paused:true,stopReason:'snoozed',
      });
      expect(paused?.timeRemainingHours).toBeCloseTo(2/3);
      snooze(db,'tenant-A','snooze-debt','2026-09-20T12:00:00.000Z',null,'2026-09-20T10:40:00.000Z');
      expect(clock(db,'tenant-A','snooze-debt')).toMatchObject({
        active_since:null,accrued_active_ms:1_200_000,stop_reason:'snoozed',revision:3,
      });
      // A late due worker resumes at the recorded deadline, not its execution time.
      snooze(db,'tenant-A','snooze-debt',null,'due','2026-09-20T12:10:00.000Z');
      expect(clock(db,'tenant-A','snooze-debt')).toMatchObject({
        active_since:'2026-09-20T12:00:00.000Z',updated_at:'2026-09-20T12:10:00.000Z',
      });
      expect(projectPriorityClock(clock(db,'tenant-A','snooze-debt'),Date.parse('2026-09-20T12:20:00Z'))).toMatchObject({
        elapsedActiveMs:2_400_000,paused:false,stopReason:null,
      });
      snooze(db,'tenant-A','snooze-debt','2026-09-20T14:00:00.000Z',null,'2026-09-20T12:30:00.000Z');
      expect(clock(db,'tenant-A','snooze-debt')).toMatchObject({accrued_active_ms:3_000_000,stop_reason:'snoozed'});
      snooze(db,'tenant-A','snooze-debt',null,'manual','2026-09-20T13:00:00.000Z');
      const overdue = projectPriorityClock(clock(db,'tenant-A','snooze-debt'),Date.parse('2026-09-20T13:30:00Z'));
      expect(overdue).toMatchObject({elapsedActiveMs:4_800_000,paused:false,stopReason:null});
      expect(overdue?.timeRemainingHours).toBeCloseTo(-1/3);
    } finally { db.close(); }
  });

  it('keeps resolved and waiting precedence when snooze overlaps, then resumes only when actionable', () => {
    const db = dbWithClock();
    try {
      ticket(db,'tenant-A','overlap');
      state(db,'tenant-A','overlap','legacy-pending','awaiting customer','2026-09-20T10:10:00.000Z');
      snooze(db,'tenant-A','overlap','2026-09-20T11:30:00.000Z',null,'2026-09-20T10:15:00.000Z');
      expect(clock(db,'tenant-A','overlap')).toMatchObject({accrued_active_ms:600_000,stop_reason:'waiting'});
      state(db,'tenant-A','overlap','legacy-pending',null,'2026-09-20T10:30:00.000Z');
      expect(clock(db,'tenant-A','overlap')).toMatchObject({accrued_active_ms:600_000,stop_reason:'snoozed'});
      state(db,'tenant-A','overlap','legacy-resolved',null,'2026-09-20T11:00:00.000Z');
      expect(clock(db,'tenant-A','overlap')).toMatchObject({accrued_active_ms:600_000,stop_reason:'resolved'});
      snooze(db,'tenant-A','overlap',null,'due','2026-09-20T11:30:00.000Z');
      expect(clock(db,'tenant-A','overlap')).toMatchObject({active_since:null,accrued_active_ms:600_000,stop_reason:'resolved'});
      state(db,'tenant-A','overlap','legacy-open',null,'2026-09-20T12:00:00.000Z');
      expect(projectPriorityClock(clock(db,'tenant-A','overlap'),Date.parse('2026-09-20T12:10:00Z'))).toMatchObject({
        elapsedActiveMs:1_200_000,paused:false,stopReason:null,
      });
    } finally { db.close(); }
  });

  it('resumes on a canonical customer reply without affecting an equal-ID ticket in another tenant or replaying debt', () => {
    const db = dbWithClock();
    try {
      ticket(db,'tenant-A','same');
      ticket(db,'tenant-B','same');
      snooze(db,'tenant-A','same','2026-09-20T12:00:00.000Z',null,'2026-09-20T10:10:00.000Z');
      const beforeB = clock(db,'tenant-B','same');
      snooze(db,'tenant-A','same',null,'customer_reply','2026-09-20T10:50:00.000Z');
      const resumed = projectPriorityClock(clock(db,'tenant-A','same'),Date.parse('2026-09-20T11:00:00Z'));
      expect(resumed).toMatchObject({
        elapsedActiveMs:1_200_000,paused:false,stopReason:null,
      });
      expect(resumed?.timeRemainingHours).toBeCloseTo(2/3);
      expect(clock(db,'tenant-B','same')).toEqual(beforeB);
      const afterReply = clock(db,'tenant-A','same');
      db.prepare(`UPDATE ticket_support_state SET snoozed_until='2026-09-20T13:00:00.000Z',
        changed_at='2026-09-20T11:05:00.000Z' WHERE tenant_id='tenant-A' AND ticket_id='same'`).run();
      expect(clock(db,'tenant-A','same')).toEqual(afterReply);
      db.prepare(`UPDATE ticket_support_state SET snoozed_until=NULL,revision=1,
        changed_at='2026-09-20T11:10:00.000Z' WHERE tenant_id='tenant-A' AND ticket_id='same'`).run();
      expect(clock(db,'tenant-A','same')).toEqual(afterReply);
    } finally { db.close(); }
  });

  it('bounds an artificial future due tick to the actual state-change instant', () => {
    const db = dbWithClock();
    try {
      ticket(db,'tenant-A','future-due');
      snooze(db,'tenant-A','future-due','2026-09-20T13:00:00.000Z',null,'2026-09-20T10:10:00.000Z');
      snooze(db,'tenant-A','future-due',null,'due','2026-09-20T11:00:00.000Z');
      expect(clock(db,'tenant-A','future-due')).toMatchObject({
        active_since:'2026-09-20T11:00:00.000Z',updated_at:'2026-09-20T11:00:00.000Z',
        accrued_active_ms:600_000,stop_reason:null,
      });
      expect(projectPriorityClock(clock(db,'tenant-A','future-due'),Date.parse('2026-09-20T11:10:00Z'))).toMatchObject({
        elapsedActiveMs:1_200_000,paused:false,
      });
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
      expect(clock(db,'tenant-B','same')).toMatchObject({accrued_active_ms:0,active_since:'2026-09-20T10:00:00.000Z',stop_reason:null,revision:2});
      expect(projectPriorityClock(clock(db,'tenant-B','same'),Date.parse('2026-09-20T10:15:00Z'))?.elapsedActiveMs).toBe(900_000);
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
