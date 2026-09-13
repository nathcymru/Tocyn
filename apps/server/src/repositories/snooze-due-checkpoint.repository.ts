import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { budgetCommitConstraint, budgetGrantOperationStatements } from './budget-commit-fence';

import { assertSnoozeDueAuthority, validateSnoozeStepInput, type SnoozeReadInput, type SnoozeStepInput } from '../budgets/snooze-due-intent';
export { validateSnoozeStepInput } from '../budgets/snooze-due-intent';

export type SnoozeDueCheckpoint = Readonly<{ generation: number; step_id: string; due_through: string;
  ticket_id: string | null; original_revision: number | null; original_deadline: string | null;
  outcome: 'empty' | 'resurfaced'; original_aggregate_id: string; original_reservation_id: string;
  original_holder_id: string; original_operation_id: string; original_operation_fingerprint: string }>;
export type SnoozeDueSnapshot = Readonly<{ activeSnoozes: number; checkpoint: SnoozeDueCheckpoint | null }>;

const SQL_0 = `INSERT INTO budget_mutation_assertion(tenant_id,accepted)
SELECT :tenant, CASE WHEN
  COALESCE((SELECT active_snoozes FROM snooze_scheduler_tenants WHERE tenant_id=:tenant),0)=:snapshot_n
  AND (SELECT COUNT(*) FROM (SELECT ticket_id FROM ticket_support_state
    INDEXED BY idx_ticket_support_state_snooze
    WHERE tenant_id=:tenant AND snoozed_until IS NOT NULL LIMIT :snapshot_sentinel))=:snapshot_n
  AND :expected_generation BETWEEN 0 AND 9007199254740990
  AND COALESCE((SELECT generation FROM snooze_due_checkpoint WHERE tenant_id=:tenant),0)=:expected_generation
  AND NOT EXISTS(SELECT 1 FROM snooze_due_checkpoint WHERE tenant_id=:tenant AND step_id=:step_id)
  THEN 1 ELSE 0 END
ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted;`;

const SQL_1 = `INSERT INTO snooze_due_checkpoint
  (tenant_id,generation,step_id,due_through,ticket_id,original_revision,
   original_deadline,definition_id,outcome,original_aggregate_id,
   original_reservation_id,original_holder_id,original_operation_id,original_operation_fingerprint)
SELECT :tenant,:expected_generation+1,:step_id,:due_through,
  s.ticket_id,s.revision,s.snoozed_until,s.definition_id,
  CASE WHEN s.ticket_id IS NULL THEN 'empty' ELSE 'resurfaced' END,
  :aggregate,:reservation,:holder,:operation,:fingerprint
FROM (SELECT 1) seed LEFT JOIN
  (SELECT ticket_id,revision,snoozed_until,definition_id FROM ticket_support_state
   INDEXED BY idx_ticket_support_state_snooze
   WHERE tenant_id=:tenant AND snoozed_until IS NOT NULL AND snoozed_until<=:due_through
   ORDER BY snoozed_until,ticket_id LIMIT 1) s ON 1=1
ON CONFLICT(tenant_id) DO UPDATE SET
  generation=excluded.generation,step_id=excluded.step_id,due_through=excluded.due_through,
  ticket_id=excluded.ticket_id,original_revision=excluded.original_revision,
  original_deadline=excluded.original_deadline,definition_id=excluded.definition_id,
  outcome=excluded.outcome,original_aggregate_id=excluded.original_aggregate_id,
  original_reservation_id=excluded.original_reservation_id,original_holder_id=excluded.original_holder_id,
  original_operation_id=excluded.original_operation_id,original_operation_fingerprint=excluded.original_operation_fingerprint
WHERE snooze_due_checkpoint.generation=:expected_generation;`;

const SQL_2 = `INSERT INTO support_state_events
 (tenant_id,id,ticket_id,definition_id,kind,actor_kind,actor_id,facts)
SELECT c.tenant_id,c.step_id,s.ticket_id,s.definition_id,'ticket.transition','system',NULL,
 json_object('before',json_object('snoozedUntil',s.snoozed_until),
 'after',json_object('snoozedUntil',NULL,'resurfaceReason','due'),
 'trigger',json_object('dueThrough',c.due_through))
FROM snooze_due_checkpoint c JOIN ticket_support_state s
 ON s.tenant_id=c.tenant_id AND s.ticket_id=c.ticket_id
WHERE c.tenant_id=:tenant AND c.step_id=:step_id AND c.generation=:expected_generation+1
 AND c.outcome='resurfaced' AND s.revision=c.original_revision
 AND s.snoozed_until=c.original_deadline AND s.snoozed_until<=c.due_through;`;

const SQL_3 = `UPDATE ticket_support_state AS s SET snoozed_until=NULL,resurface_reason='due',
 changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1
WHERE s.tenant_id=:tenant AND s.ticket_id=(SELECT ticket_id FROM snooze_due_checkpoint WHERE tenant_id=:tenant)
 AND EXISTS(SELECT 1 FROM snooze_due_checkpoint c
 WHERE c.tenant_id=s.tenant_id AND c.ticket_id=s.ticket_id AND c.step_id=:step_id
 AND c.generation=:expected_generation+1 AND c.outcome='resurfaced'
 AND c.original_revision=s.revision AND c.original_deadline=s.snoozed_until
 AND s.snoozed_until<=c.due_through);`;

/** No scheduler or public route invokes this repository yet. Caller owns fresh
 * admission/terminal settlement. Unknown original work is never certified here. */
export class SnoozeDueCheckpointRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  private prefix(authority: BudgetCommitAuthority, purpose: 'new-work' | 'recovery' = 'new-work'): D1PreparedStatement[] {
    const gate = budgetCommitConstraint(authority, this.scope.tenantId, [purpose]);
    const system = this.scope.roles.includes('system') && this.scope.actorId === 'scheduled-snooze-resurface';
    const assertion = this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN ?=1 AND ${gate.sql} THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
      .bind(this.scope.tenantId, system ? 1 : 0, ...gate.values);
    return [assertion, ...budgetGrantOperationStatements(this.db, this.scope, authority)];
  }

  /** Exact newly admitted read; also used after restart/lost response. Does not
   * relabel the original operation or refund its reserved liability. */
  async read(input: SnoozeReadInput, authority: BudgetCommitAuthority): Promise<SnoozeDueSnapshot> {
    const intent = { family: 'read' as const, input: { ...input } };
    const admitted = structuredClone(authority);
    await assertSnoozeDueAuthority(this.scope.tenantId, intent, admitted);
    const rows = await this.db.batch([...this.prefix(admitted, intent.input.purpose),
      this.db.prepare('SELECT active_snoozes FROM snooze_scheduler_tenants WHERE tenant_id=?').bind(this.scope.tenantId),
      this.db.prepare('SELECT * FROM snooze_due_checkpoint WHERE tenant_id=?').bind(this.scope.tenantId),
    ]);
    const activeSnoozes = (rows[3].results[0] as { active_snoozes: number } | undefined)?.active_snoozes ?? 0;
    if (!Number.isSafeInteger(activeSnoozes) || activeSnoozes < 0) throw new Error('Invalid snooze population');
    return { activeSnoozes, checkpoint: (rows[4].results[0] as SnoozeDueCheckpoint | undefined) ?? null };
  }

  async advance(value: SnoozeStepInput, authority: BudgetCommitAuthority): Promise<SnoozeDueCheckpoint> {
    const input = validateSnoozeStepInput(value);
    if (!input || input.activeSnoozeSnapshot === Number.MAX_SAFE_INTEGER) throw new Error('Invalid snooze step');
    const admitted = structuredClone(authority);
    await assertSnoozeDueAuthority(this.scope.tenantId, { family: 'advance', input }, admitted);
    const grant = admitted.grant;
    const params: Record<string, string | number> = { tenant: this.scope.tenantId,
      expected_generation: input.expectedGeneration, step_id: input.stepId, due_through: input.dueThrough,
      snapshot_n: input.activeSnoozeSnapshot, snapshot_sentinel: input.activeSnoozeSnapshot + 1,
      aggregate: grant?.aggregateId ?? '', reservation: grant?.reservationId ?? '', holder: grant?.holderId ?? '',
      operation: admitted.operationId, fingerprint: admitted.operationFingerprint };
    const prepare = (sql: string) => {
      const values: (string | number)[] = [];
      const bound = sql.replace(/:([a-z_]+)/g, (_, name: string) => {
        if (!(name in params)) throw new Error('Invalid internal SQL parameter');
        values.push(params[name]); return '?';
      });
      return this.db.prepare(bound).bind(...values);
    };
    const changed = () => this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN changes()=
      (SELECT CASE WHEN outcome='resurfaced' THEN 1 ELSE 0 END FROM snooze_due_checkpoint WHERE tenant_id=?)
      THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(this.scope.tenantId, this.scope.tenantId);
    const rows = await this.db.batch([...this.prefix(admitted), prepare(SQL_0), prepare(SQL_1),
      this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN changes()=1 THEN 1 ELSE 0 END WHERE tenant_id=?`).bind(this.scope.tenantId),
      prepare(SQL_2), changed(), prepare(SQL_3), changed(),
      this.db.prepare('SELECT * FROM snooze_due_checkpoint WHERE tenant_id=?').bind(this.scope.tenantId),
    ]);
    const result = rows[rows.length - 1].results[0] as SnoozeDueCheckpoint | undefined;
    if (!result) throw new Error('Missing snooze checkpoint');
    return result;
  }
}
