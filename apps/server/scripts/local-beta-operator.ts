import type Database from 'better-sqlite3';
import { validateBetaInitialization, type BetaInitialization } from '../src/types/local-beta';

type Action = 'stop-intake' | 'stop-writes' | 'resume';
/** Local filesystem operator only. Never import into a Worker or expose through HTTP. */
export class LocalBetaOperator {
  constructor(private db: Database.Database) {}

  status() {
    return this.db.prepare(`SELECT p.run_id,p.revision,p.state,r.ticket_limit,r.mutation_limit,r.recovery_reserve,r.upload_limit,r.tickets,r.mutations,r.upload_attempts
      FROM local_beta_policy p JOIN local_beta_runs r ON r.run_id=p.run_id WHERE p.singleton=1`).get() as
      { run_id: string; revision: number; state: string; tickets: number; mutations: number; upload_attempts: number } | undefined;
  }

  initialize(input: BetaInitialization, expectedRevision: number) {
    const validated = validateBetaInitialization(input);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Expected revision must be a non-negative integer');
    return this.db.transaction(() => {
      const prior = this.status();
      if ((prior?.revision ?? 0) !== expectedRevision) throw new Error('Policy revision changed; inspect status and retry explicitly');
      for (const invite of validated.invitations) {
        const exists = invite.kind === 'api-key'
          ? this.db.prepare('SELECT 1 FROM api_keys WHERE tenant_id=? AND id=? AND is_active=1').get(invite.tenantId, invite.id)
          : this.db.prepare(`SELECT 1 FROM users WHERE tenant_id=? AND id=? AND ${invite.kind === 'customer' ? "role='customer'" : "role IN ('admin','agent')"}`).get(invite.tenantId, invite.id);
        if (!exists) throw new Error('An invitation must refer to an existing principal of the exact tenant and kind');
      }
      const l = validated.limits;
      this.db.prepare('INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES (?,?,?,?,?)')
        .run(validated.runId,l.ticketLimit,l.mutationLimit,l.recoveryReserve,l.uploadLimit);
      for (const tenant of validated.tenants) this.db.prepare('INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES (?,?)').run(validated.runId,tenant);
      for (const i of validated.invitations) this.db.prepare('INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES (?,?,?,?)').run(validated.runId,i.tenantId,i.kind,i.id);
      this.db.prepare(`INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES (1,?,?,'running')
        ON CONFLICT(singleton) DO UPDATE SET run_id=excluded.run_id,revision=excluded.revision,state=excluded.state`).run(validated.runId,expectedRevision+1);
      this.db.prepare('INSERT INTO local_beta_operator_receipts(revision,action,run_id,prior_run_id,prior_tickets,prior_mutations,prior_upload_attempts) VALUES (?,?,?,?,?,?,?)')
        .run(expectedRevision+1,prior ? 'new-run' : 'initialize',validated.runId,prior?.run_id ?? null,prior?.tickets ?? 0,prior?.mutations ?? 0,prior?.upload_attempts ?? 0);
      return this.status();
    }).immediate();
  }

  change(action: Action, expectedRevision: number) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !['stop-intake','stop-writes','resume'].includes(action)) throw new Error('Invalid operator command');
    return this.db.transaction(() => {
      const prior = this.status();
      if (!prior || prior.revision !== expectedRevision) throw new Error('Policy revision changed; inspect status and retry explicitly');
      const state = { 'stop-intake': 'intake_stopped', 'stop-writes': 'writes_stopped', resume: 'running' }[action];
      this.db.prepare('UPDATE local_beta_policy SET state=?, revision=revision+1 WHERE singleton=1 AND revision=?').run(state,expectedRevision);
      this.db.prepare('INSERT INTO local_beta_operator_receipts(revision,action,run_id,prior_run_id,prior_tickets,prior_mutations,prior_upload_attempts) VALUES (?,?,?,?,?,?,?)')
        .run(expectedRevision+1,action,prior.run_id,prior.run_id,prior.tickets,prior.mutations,prior.upload_attempts);
      return this.status();
    }).immediate();
  }
}
