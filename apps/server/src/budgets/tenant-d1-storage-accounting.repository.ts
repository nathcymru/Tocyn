import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';

/**
 * Maximum storage growth that one lifecycle operation may reserve. Callers
 * compose larger work into bounded operations rather than creating a grant
 * that can pin an unbounded portion of a tenant's D1 allocation.
 */
export const MAX_TENANT_D1_STORAGE_ENVELOPE_BYTES = 1_048_576;

export type TenantD1StorageAllocation = Readonly<{
  /** Server-authorized tenant allocation, never a client setting. */
  ceilingBytes: number;
  /** Monotonic revision supplied by the trusted owner-policy boundary. */
  revision: number;
}>;

export type TenantD1StorageReservation = Readonly<{
  operationId: string;
  operationFingerprint: string;
  envelopeBytes: number;
  allocation: TenantD1StorageAllocation;
  now: number;
}>;

export type TenantD1StorageSnapshot = Readonly<{
  allocationBytes: number;
  allocationRevision: number;
  attributedBytes: number;
  reservedBytes: number;
  uncertainBytes: number;
}>;

export type TenantD1StorageReservationOutcome = Readonly<{
  status: 'reserved' | 'idempotent' | 'reconciled' | 'uncertain' | 'conflict' | 'exhausted' | 'stale-allocation' | 'unavailable';
  snapshot?: TenantD1StorageSnapshot;
}>;

export type TenantD1StorageReconciliation = Readonly<{
  operationId: string;
  operationFingerprint: string;
  /**
   * Conservatively attributed growth proven by this lifecycle operation. It is
   * not D1's database-wide physical size and must be no greater than the
   * envelope held before the write.
   */
  attributedBytes: number;
  evidenceId: string;
  now: number;
}>;

type AccountRow = Readonly<{
  allocation_bytes: number;
  allocation_revision: number;
  attributed_bytes: number;
  reserved_bytes: number;
  uncertain_bytes: number;
}>;

type ReservationRow = Readonly<{
  operation_id: string;
  operation_fingerprint: string;
  allocation_revision: number;
  envelope_bytes: number;
  status: 'reserved' | 'uncertain' | 'reconciled';
  attributed_bytes: number | null;
  evidence_id: string | null;
}>;

function safeNonNegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function safeIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

function snapshot(row: AccountRow): TenantD1StorageSnapshot {
  return Object.freeze({ allocationBytes: row.allocation_bytes, allocationRevision: row.allocation_revision,
    attributedBytes: row.attributed_bytes, reservedBytes: row.reserved_bytes, uncertainBytes: row.uncertain_bytes });
}

/**
 * Durable, tenant-scoped accounting for D1 storage growth. It records a
 * conservative application attribution for a tenant; it does not infer a
 * tenant share from D1 `meta.size_after`, which is database-wide.
 *
 * A caller reserves before a customer or authentication lifecycle write. A
 * lost response moves the whole envelope to `uncertain`, which stays charged
 * until a later idempotent reconciliation supplies terminal evidence.
 */
export class TenantD1StorageAccountingRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async reserve(request: TenantD1StorageReservation): Promise<TenantD1StorageReservationOutcome> {
    if (!this.validReservation(request)) return { status: 'unavailable' };
    const allocated = await this.ensureAllocation(request.allocation, request.now);
    if (allocated !== 'ready') return { status: allocated };

    const known = await this.reservation(request.operationId);
    if (known) return this.reservationOutcome(known, request);

    try {
      await this.db.prepare(`INSERT INTO tenant_d1_storage_reservations
        (tenant_id,operation_id,operation_fingerprint,allocation_revision,envelope_bytes,status,created_at,state_changed_at)
        VALUES (?,?,?,?,?,'reserved',?,?)`)
        .bind(this.scope.tenantId, request.operationId, request.operationFingerprint, request.allocation.revision,
          request.envelopeBytes, request.now, request.now).run();
      return { status: 'reserved', snapshot: await this.currentSnapshot() ?? undefined };
    } catch (error) {
      // A duplicated request may have committed before a lost D1 response.
      const raced = await this.reservation(request.operationId).catch(() => null);
      if (raced) return this.reservationOutcome(raced, request);
      if (String(error).includes('tenant_d1_storage_capacity_exhausted')) return { status: 'exhausted' };
      return { status: 'unavailable' };
    }
  }

  async markUncertain(operationId: string, operationFingerprint: string, now: number): Promise<TenantD1StorageReservationOutcome> {
    if (!safeIdentity(operationId) || !safeIdentity(operationFingerprint) || !safeNonNegativeInteger(now)) return { status: 'unavailable' };
    const known = await this.reservation(operationId).catch(() => null);
    if (!known) return { status: 'unavailable' };
    if (known.operation_fingerprint !== operationFingerprint) return { status: 'conflict' };
    if (known.status === 'uncertain') return { status: 'idempotent', snapshot: await this.currentSnapshot() ?? undefined };
    if (known.status === 'reconciled') return { status: 'reconciled', snapshot: await this.currentSnapshot() ?? undefined };
    try {
      await this.db.prepare(`UPDATE tenant_d1_storage_reservations SET status='uncertain', state_changed_at=?
        WHERE tenant_id=? AND operation_id=? AND operation_fingerprint=? AND status='reserved'`)
        .bind(now, this.scope.tenantId, operationId, operationFingerprint).run();
      const after = await this.reservation(operationId);
      if (after?.status === 'uncertain') return { status: 'uncertain', snapshot: await this.currentSnapshot() ?? undefined };
      return { status: 'unavailable' };
    } catch { return { status: 'unavailable' }; }
  }

  async reconcile(input: TenantD1StorageReconciliation): Promise<TenantD1StorageReservationOutcome> {
    if (!safeIdentity(input.operationId) || !safeIdentity(input.operationFingerprint) || !safeIdentity(input.evidenceId)
      || !safeNonNegativeInteger(input.attributedBytes, MAX_TENANT_D1_STORAGE_ENVELOPE_BYTES) || !safeNonNegativeInteger(input.now)) return { status: 'unavailable' };
    const known = await this.reservation(input.operationId).catch(() => null);
    if (!known) return { status: 'unavailable' };
    if (known.operation_fingerprint !== input.operationFingerprint) return { status: 'conflict' };
    if (known.status === 'reconciled') {
      return known.attributed_bytes === input.attributedBytes && known.evidence_id === input.evidenceId
        ? { status: 'idempotent', snapshot: await this.currentSnapshot() ?? undefined } : { status: 'conflict' };
    }
    // An overrun remains held as uncertain. Releasing an underestimated write
    // would allow later work to exceed the tenant's owner allocation.
    if (input.attributedBytes > known.envelope_bytes) return { status: 'unavailable' };
    try {
      await this.db.prepare(`UPDATE tenant_d1_storage_reservations
        SET status='reconciled', attributed_bytes=?, evidence_id=?, state_changed_at=?, reconciled_at=?
        WHERE tenant_id=? AND operation_id=? AND operation_fingerprint=? AND status=?`)
        .bind(input.attributedBytes, input.evidenceId, input.now, input.now, this.scope.tenantId,
          input.operationId, input.operationFingerprint, known.status).run();
      const after = await this.reservation(input.operationId);
      if (after?.status === 'reconciled') {
        return after.attributed_bytes === input.attributedBytes && after.evidence_id === input.evidenceId
          ? { status: 'reconciled', snapshot: await this.currentSnapshot() ?? undefined } : { status: 'conflict' };
      }
      return { status: 'unavailable' };
    } catch { return { status: 'unavailable' }; }
  }

  async currentSnapshot(): Promise<TenantD1StorageSnapshot | null> {
    const row = await this.db.prepare(`SELECT allocation_bytes,allocation_revision,attributed_bytes,reserved_bytes,uncertain_bytes
      FROM tenant_d1_storage_accounts WHERE tenant_id=?`).bind(this.scope.tenantId).first<AccountRow>();
    return row ? snapshot(row) : null;
  }

  private validReservation(request: TenantD1StorageReservation): boolean {
    return safeIdentity(request.operationId) && safeIdentity(request.operationFingerprint) && safeNonNegativeInteger(request.now)
      && safeNonNegativeInteger(request.envelopeBytes, MAX_TENANT_D1_STORAGE_ENVELOPE_BYTES) && request.envelopeBytes > 0
      && safeNonNegativeInteger(request.allocation.ceilingBytes) && safeNonNegativeInteger(request.allocation.revision);
  }

  private async ensureAllocation(allocation: TenantD1StorageAllocation, now: number): Promise<'ready' | 'exhausted' | 'stale-allocation' | 'unavailable'> {
    try {
      await this.db.prepare(`INSERT INTO tenant_d1_storage_accounts
        (tenant_id,allocation_bytes,allocation_revision,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO NOTHING`)
        .bind(this.scope.tenantId, allocation.ceilingBytes, allocation.revision, now).run();
      let current = await this.currentSnapshot();
      if (!current) return 'unavailable';
      if (current.allocationRevision === allocation.revision) return current.allocationBytes === allocation.ceilingBytes ? 'ready' : 'stale-allocation';
      if (current.allocationRevision > allocation.revision) return 'stale-allocation';
      const result = await this.db.prepare(`UPDATE tenant_d1_storage_accounts
        SET allocation_bytes=?, allocation_revision=?, updated_at=?
        WHERE tenant_id=? AND allocation_revision<?
          AND attributed_bytes+reserved_bytes+uncertain_bytes<=?`)
        .bind(allocation.ceilingBytes, allocation.revision, now, this.scope.tenantId, allocation.revision, allocation.ceilingBytes).run();
      if (result.meta.changes === 1) return 'ready';
      current = await this.currentSnapshot();
      if (!current) return 'unavailable';
      if (current.allocationRevision >= allocation.revision) return current.allocationRevision === allocation.revision
        && current.allocationBytes === allocation.ceilingBytes ? 'ready' : 'stale-allocation';
      return 'exhausted';
    } catch { return 'unavailable'; }
  }

  private async reservation(operationId: string): Promise<ReservationRow | null> {
    return this.db.prepare(`SELECT operation_id,operation_fingerprint,allocation_revision,envelope_bytes,status,attributed_bytes,evidence_id
      FROM tenant_d1_storage_reservations WHERE tenant_id=? AND operation_id=?`)
      .bind(this.scope.tenantId, operationId).first<ReservationRow>();
  }

  private async reservationOutcome(known: ReservationRow, request: TenantD1StorageReservation): Promise<TenantD1StorageReservationOutcome> {
    if (known.operation_fingerprint !== request.operationFingerprint || known.envelope_bytes !== request.envelopeBytes
      || known.allocation_revision !== request.allocation.revision) return { status: 'conflict' };
    const current = await this.currentSnapshot();
    if (known.status === 'reserved') return { status: 'idempotent', snapshot: current ?? undefined };
    if (known.status === 'uncertain') return { status: 'uncertain', snapshot: current ?? undefined };
    return { status: 'reconciled', snapshot: current ?? undefined };
  }
}
