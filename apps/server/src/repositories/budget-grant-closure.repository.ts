import { RESOURCE_DIMENSIONS, type ResourceAmounts } from '@luminatick/shared';
import type { D1Database } from '@cloudflare/workers-types';
import type { SealedIsolateBudgetGrant } from '../budgets/isolate-admission.service';
import { ISOLATE_COLD_ENVELOPE, MAX_ISOLATE_BLOCK_OPERATIONS } from '../budgets/isolate-admission.service';

type OperationRow = { operation_id: string; operation_fingerprint: string; operation_envelope_json: string; aggregate_id: string };
type ClosureRow = { aggregate_id: string; terminal_evidence_id: string; operation_set_fingerprint: string; operation_count: number; measured_json: string; uncertain_json: string; expires_at: number | null };
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

function validAmounts(value: ResourceAmounts): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
    && Object.entries(value).every(([dimension,units]) => (RESOURCE_DIMENSIONS as readonly string[]).includes(dimension)
      && Number.isSafeInteger(units) && units >= 0) && Object.values(value).some(units => units > 0);
}
function identity(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Durable, bounded proof that one sealed isolate grant has exactly its local operation set. */
export class BudgetGrantClosureRepository {
  constructor(private readonly db: D1Database) {}

  async close(sealed: SealedIsolateBudgetGrant): Promise<DurableGrantClosure | null> {
    if (![sealed.tenantId,sealed.aggregateId,sealed.reservationId,sealed.holderId,sealed.terminalEvidenceId].every(identity)
      || !Array.isArray(sealed.operations) || !Array.isArray(sealed.operationIds) || !Array.isArray(sealed.operationEnvelopes)
      || sealed.operations.length < 1 || sealed.operations.length > MAX_ISOLATE_BLOCK_OPERATIONS
      || sealed.operationIds.length !== sealed.operations.length || sealed.operationEnvelopes.length !== sealed.operations.length
      || new Set(sealed.operationIds).size !== sealed.operations.length || !validAmounts(sealed.envelope)
      || !Number.isSafeInteger(sealed.expiresAt) || sealed.expiresAt < 1
      || sealed.operations.some((operation,index) => !operation || !identity(operation.operationId) || !identity(operation.operationFingerprint)
        || !validAmounts(operation.operationEnvelope) || operation.operationId !== sealed.operationIds[index]
        || JSON.stringify(operation.operationEnvelope) !== JSON.stringify(sealed.operationEnvelopes[index]))) return null;
    const expected = [...sealed.operations].sort((left,right) => left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0);
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
    let uncertain: ResourceAmounts;
    try { uncertain = amounts([ISOLATE_COLD_ENVELOPE,...envelopes]); } catch { return null; }
    if (RESOURCE_DIMENSIONS.some(dimension => (uncertain[dimension] ?? 0) > (sealed.envelope[dimension] ?? 0))) return null;
    const measured: ResourceAmounts = {};
    const existing = await this.db.prepare(`SELECT aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json,expires_at
      FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?`)
      .bind(sealed.tenantId,sealed.reservationId,sealed.holderId).first<ClosureRow>();
    if (existing) {
      if (existing.aggregate_id !== sealed.aggregateId || existing.terminal_evidence_id !== sealed.terminalEvidenceId
        || existing.operation_set_fingerprint !== operationSetFingerprint || existing.operation_count !== rows.length
        || existing.measured_json !== canonical(measured) || existing.uncertain_json !== canonical(uncertain)
        || existing.expires_at !== sealed.expiresAt) return null;
      return { terminalEvidenceId: existing.terminal_evidence_id, uncertain, operationSetFingerprint };
    }
    // The count predicate and the operation-link closure predicate jointly fence
    // races: a late canonical batch cannot add a row after this insert.
    await this.db.prepare(`INSERT INTO budget_grant_closures
      (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM budget_grant_operations
        WHERE tenant_id=? AND reservation_id=? AND holder_id=?)=? ON CONFLICT DO NOTHING`)
      .bind(sealed.tenantId,sealed.reservationId,sealed.holderId,sealed.aggregateId,sealed.terminalEvidenceId,operationSetFingerprint,rows.length,
        canonical(measured),canonical(uncertain),sealed.expiresAt,sealed.tenantId,sealed.reservationId,sealed.holderId,rows.length).run();
    // D1's changes count for INSERT…SELECT is not portable evidence of an
    // insert. Read the bounded primary-key row and require the exact payload.
    const written = await this.db.prepare(`SELECT aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json,expires_at
      FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=?`)
      .bind(sealed.tenantId,sealed.reservationId,sealed.holderId).first<ClosureRow>();
    if (!written || written.aggregate_id !== sealed.aggregateId || written.terminal_evidence_id !== sealed.terminalEvidenceId
      || written.operation_set_fingerprint !== operationSetFingerprint || written.operation_count !== rows.length
      || written.measured_json !== canonical(measured) || written.uncertain_json !== canonical(uncertain)
      || written.expires_at !== sealed.expiresAt) return null;
    return { terminalEvidenceId: sealed.terminalEvidenceId, uncertain, operationSetFingerprint };
  }

  /**
   * Closure evidence can no longer authorize recovery after its bounded grant
   * expiry. Delete at most two closed grants and their at-most-eight links;
   * uncertain grants have no closure row and therefore cannot be removed here.
   */
  async pruneExpired(tenantId: string, now: number): Promise<void> {
    if (!identity(tenantId) || !Number.isSafeInteger(now) || now < 0) return;
    const rows = (await this.db.prepare(`SELECT reservation_id,holder_id FROM budget_grant_closures
      WHERE tenant_id=? AND expires_at<=? ORDER BY expires_at,reservation_id,holder_id LIMIT 2`).bind(tenantId,now)
      .all<{ reservation_id: string; holder_id: string }>()).results;
    if (!rows.length) return;
    await this.db.batch(rows.flatMap(row => [
      this.db.prepare(`DELETE FROM budget_grant_operations WHERE tenant_id=? AND reservation_id=? AND holder_id=?`)
        .bind(tenantId,row.reservation_id,row.holder_id),
      this.db.prepare(`DELETE FROM budget_grant_closures WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND expires_at<=?`)
        .bind(tenantId,row.reservation_id,row.holder_id,now),
    ]));
  }
}
