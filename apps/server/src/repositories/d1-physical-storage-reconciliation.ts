import type { D1Database } from '@cloudflare/workers-types';

/**
 * Cloudflare D1 returns `meta.size_after` only after a successful statement
 * has committed. It is the allocation of the whole database, not a size for
 * the row, request, operation, or tenant that triggered the statement.
 */
export type D1PhysicalStorageEvidence = Readonly<{
  databaseSizeAfter: number;
}>;

export type D1PhysicalStorageOperation = Readonly<{
  tenantId: string;
  reservationId: string;
  holderId: string;
  aggregateId: string;
  operationId: string;
  operationFingerprint: string;
  observedAt: number;
}>;

type D1ResultMeta = Readonly<{ success?: unknown; meta?: Readonly<{ size_after?: unknown }> }>;

function evidenceFromResult(result: unknown): D1PhysicalStorageEvidence | null {
  if (!result || typeof result !== 'object' || (result as D1ResultMeta).success === false) return null;
  const sizeAfter = (result as D1ResultMeta).meta?.size_after;
  return typeof sizeAfter === 'number' && Number.isSafeInteger(sizeAfter) && sizeAfter >= 0
    ? { databaseSizeAfter: sizeAfter } : null;
}

/**
 * Extracts only a reported post-commit database allocation. A batch is usable
 * only when all its result envelopes succeeded; the last reported result is
 * retained as an observation, never converted into a per-tenant delta.
 */
export function postCommitD1PhysicalStorageEvidence(result: unknown): D1PhysicalStorageEvidence | null {
  if (!Array.isArray(result)) return evidenceFromResult(result);
  if (!result.length || result.some(item => (item as D1ResultMeta | null)?.success === false)) return null;
  for (let index = result.length - 1; index >= 0; index--) {
    const evidence = evidenceFromResult(result[index]);
    if (evidence) return evidence;
  }
  return null;
}

function validIdentity(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Retains an opaque, database-scoped observation on the already-linked,
 * admitted operation. The operation link remains tenant-authorized, but the
 * captured allocation is intentionally never represented as tenant usage.
 *
 * A capture failure is advisory: the original commit is already durable and
 * its conservative reservation/recovery outcome must not be changed by a
 * missing provider metadata field or by evidence persistence failure.
 */
export class D1PhysicalStorageReconciliationRepository {
  constructor(private readonly db: D1Database) {}

  async retain(operation: D1PhysicalStorageOperation, result: unknown): Promise<'retained' | 'not-reported' | 'unavailable'> {
    const evidence = postCommitD1PhysicalStorageEvidence(result);
    if (!evidence) return 'not-reported';
    if (![operation.tenantId, operation.reservationId, operation.holderId, operation.aggregateId,
      operation.operationId, operation.operationFingerprint].every(validIdentity)
      || !Number.isSafeInteger(operation.observedAt) || operation.observedAt < 0) return 'unavailable';
    try {
      const outcome = await this.db.prepare(`UPDATE budget_grant_operations
        SET d1_database_size_after=?, d1_database_size_observed_at=?
        WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND aggregate_id=?
          AND operation_id=? AND operation_fingerprint=? AND d1_database_size_after IS NULL`)
        .bind(evidence.databaseSizeAfter, operation.observedAt, operation.tenantId, operation.reservationId,
          operation.holderId, operation.aggregateId, operation.operationId, operation.operationFingerprint).run();
      return outcome.meta.changes === 1 ? 'retained' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
}
