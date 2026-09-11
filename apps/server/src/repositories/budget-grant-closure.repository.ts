import { RESOURCE_DIMENSIONS, type ResourceAmounts } from '@luminatick/shared';
import type { D1Database } from '@cloudflare/workers-types';
import type { SealedIsolateBudgetGrant } from '../budgets/isolate-admission.service';
import { ISOLATE_COLD_ENVELOPE, MAX_ISOLATE_BLOCK_OPERATIONS } from '../budgets/isolate-admission.service';

type OperationRow = { operation_id: string; operation_fingerprint: string; operation_envelope_json: string; aggregate_id: string };
type ClosureRow = { aggregate_id: string; terminal_evidence_id: string; operation_set_fingerprint: string; operation_count: number; measured_json: string; uncertain_json: string };
export type DurableGrantClosure = Readonly<{ terminalEvidenceId: string; uncertain: ResourceAmounts; operationSetFingerprint: string }>;

function amounts(value: readonly ResourceAmounts[]): ResourceAmounts {
  const total: ResourceAmounts = {};
  for (const amount of value) for (const dimension of RESOURCE_DIMENSIONS) {
    const next = (total[dimension] ?? 0) + (amount[dimension] ?? 0);
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('budget closure amount overflow');
    if (next) total[dimension] = next;
  }
  return total;
}
function canonical(value: ResourceAmounts): string {
  return JSON.stringify(RESOURCE_DIMENSIONS.map(dimension => [dimension,value[dimension] ?? 0]));
}
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

/** Durable, bounded proof that one sealed isolate grant has exactly its local operation set. */
export class BudgetGrantClosureRepository {
  constructor(private readonly db: D1Database) {}

  async close(sealed: SealedIsolateBudgetGrant): Promise<DurableGrantClosure | null> {
    if (sealed.operationIds.length < 1 || sealed.operationIds.length > MAX_ISOLATE_BLOCK_OPERATIONS) return null;
    const expected = [...sealed.operations].sort((left,right) => left.operationId.localeCompare(right.operationId));
    // The independent durable rows, not the local receipt map, are the closure proof.
    const result = await this.db.prepare(`SELECT operation_id,operation_fingerprint,operation_envelope_json,aggregate_id
      FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=? ORDER BY operation_id LIMIT ?`)
      .bind(sealed.tenantId,sealed.reservationId,sealed.holderId,MAX_ISOLATE_BLOCK_OPERATIONS + 1).all<OperationRow>();
    const rows = result.results;
    if (rows.length !== expected.length || rows.some((row,index) => row.operation_id !== expected[index].operationId
      || row.operation_fingerprint !== expected[index].operationFingerprint || row.operation_envelope_json !== JSON.stringify(expected[index].operationEnvelope)
      || row.aggregate_id !== sealed.aggregateId)) return null;
    const durableSet = rows.map(row => [row.operation_id,row.operation_fingerprint,row.operation_envelope_json]);
    const operationSetFingerprint = await digest(JSON.stringify(durableSet));
    let envelopes: ResourceAmounts[];
    try { envelopes = rows.map(row => JSON.parse(row.operation_envelope_json) as ResourceAmounts); } catch { return null; }
    const uncertain = amounts([ISOLATE_COLD_ENVELOPE,...envelopes]);
    const measured: ResourceAmounts = {};
    const existing = await this.db.prepare(`SELECT aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json
      FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?`)
      .bind(sealed.tenantId,sealed.reservationId,sealed.holderId).first<ClosureRow>();
    if (existing) {
      if (existing.aggregate_id !== sealed.aggregateId || existing.terminal_evidence_id !== sealed.terminalEvidenceId
        || existing.operation_set_fingerprint !== operationSetFingerprint || existing.operation_count !== rows.length
        || existing.measured_json !== canonical(measured) || existing.uncertain_json !== canonical(uncertain)) return null;
      return { terminalEvidenceId: existing.terminal_evidence_id, uncertain, operationSetFingerprint };
    }
    // The count predicate and the operation-link closure predicate jointly fence
    // races: a late canonical batch cannot add a row after this insert.
    await this.db.prepare(`INSERT INTO budget_grant_closures
      (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json)
      SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM budget_grant_operations
        WHERE tenant_id=? AND reservation_id=? AND holder_id=?)=?`)
      .bind(sealed.tenantId,sealed.reservationId,sealed.holderId,sealed.aggregateId,sealed.terminalEvidenceId,operationSetFingerprint,rows.length,
        canonical(measured),canonical(uncertain),sealed.tenantId,sealed.reservationId,sealed.holderId,rows.length).run();
    // D1's changes count for INSERT…SELECT is not portable evidence of an
    // insert. Read the bounded primary-key row and require the exact payload.
    const written = await this.db.prepare(`SELECT aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json
      FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?`)
      .bind(sealed.tenantId,sealed.reservationId,sealed.holderId).first<ClosureRow>();
    if (!written || written.aggregate_id !== sealed.aggregateId || written.terminal_evidence_id !== sealed.terminalEvidenceId
      || written.operation_set_fingerprint !== operationSetFingerprint || written.operation_count !== rows.length
      || written.measured_json !== canonical(measured) || written.uncertain_json !== canonical(uncertain)) return null;
    return { terminalEvidenceId: sealed.terminalEvidenceId, uncertain, operationSetFingerprint };
  }
}
