import { describe, expect, it, vi } from 'vitest';
import { D1PhysicalStorageReconciliationRepository, postCommitD1PhysicalStorageEvidence } from '../d1-physical-storage-reconciliation';
import { CUSTOMER_AUTH_ENVELOPES } from '../../budgets/customer-auth-admission.service';

const operation = {
  tenantId: 'tenant-a', reservationId: 'reservation-a', holderId: 'holder-a', aggregateId: 'aggregate-a',
  operationId: 'operation-a', operationFingerprint: 'fingerprint-a', observedAt: 1_700_000_000_000,
};

describe('D1 physical-storage reconciliation evidence', () => {
  it('pre-reserves the bounded evidence write without estimating storage bytes', () => {
    expect(CUSTOMER_AUTH_ENVELOPES.request).toMatchObject({ d1RowsWritten: 40 });
    expect(CUSTOMER_AUTH_ENVELOPES.request.d1StorageBytes).toBeUndefined();
  });

  it('retains only a successful post-commit database size without deriving a delta', () => {
    expect(postCommitD1PhysicalStorageEvidence({ success: true, meta: { size_after: 4_096 } }))
      .toEqual({ databaseSizeAfter: 4_096 });
    expect(postCommitD1PhysicalStorageEvidence([
      { success: true, meta: { size_after: 3_072 } }, { success: true, meta: { size_after: 4_096 } },
    ])).toEqual({ databaseSizeAfter: 4_096 });
  });

  it('does not treat failed, absent, fractional, or negative metadata as evidence', () => {
    expect(postCommitD1PhysicalStorageEvidence({ success: false, meta: { size_after: 4_096 } })).toBeNull();
    expect(postCommitD1PhysicalStorageEvidence({ meta: { size_after: 4_096 } })).toBeNull();
    expect(postCommitD1PhysicalStorageEvidence({ success: true, meta: {} })).toBeNull();
    expect(postCommitD1PhysicalStorageEvidence({ success: true, meta: { size_after: 1.5 } })).toBeNull();
    expect(postCommitD1PhysicalStorageEvidence([{ success: true, meta: { size_after: 4_096 } }, { success: false }])).toBeNull();
    expect(postCommitD1PhysicalStorageEvidence([{ success: true, meta: { size_after: 4_096 } }, {}])).toBeNull();
  });

  it('links the observation to the admitted operation once, and never makes capture failure a write failure', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const bind = vi.fn(() => ({ run }));
    const db = { prepare: vi.fn(() => ({ bind })) } as any;
    const repository = new D1PhysicalStorageReconciliationRepository(db);
    await expect(repository.retain(operation, { success: true, meta: { size_after: 8_192 } })).resolves.toBe('retained');
    expect(bind).toHaveBeenCalledWith(8_192, operation.observedAt, operation.tenantId, operation.reservationId,
      operation.holderId, operation.aggregateId, operation.operationId, operation.operationFingerprint);
    expect(db.prepare.mock.calls[0][0]).toContain('d1_database_size_after IS NULL');
    expect(db.prepare.mock.calls[0][0]).not.toContain('COUNT(');

    const unavailable = new D1PhysicalStorageReconciliationRepository({ prepare: () => { throw new Error('missing migration'); } } as any);
    await expect(unavailable.retain(operation, { success: true, meta: { size_after: 8_192 } })).resolves.toBe('unavailable');
  });
});
