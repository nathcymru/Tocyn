import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createSystemTenantScope } from '../../auth/scope';
import { SnoozeDueCheckpointRepository } from '../../repositories/snooze-due-checkpoint.repository';
import { assertSnoozeDueAuthority, snoozeDueEnvelope, snoozeDueFingerprint, type SnoozeDueIntent } from '../../budgets/snooze-due-intent';
import type { BudgetCommitAuthority } from '../../budgets/isolate-admission.service';
import { isolateWarmReservedEnvelope } from '../../budgets/isolate-grant-holder';
const input = { expectedGeneration: 0, stepId: 'a3200000-0000-4000-8000-000000000001', dueThrough: '2026-09-13T18:00:00.000Z', activeSnoozeSnapshot: 37 };
const advance = { family: 'advance', input } as const;
async function authority(intent: SnoozeDueIntent): Promise<BudgetCommitAuthority> {
  const operationId = intent.family === 'read' ? intent.input.readId : intent.input.stepId;
  const operationFingerprint = await snoozeDueFingerprint('tenant-a',intent);
  const operationEnvelope = isolateWarmReservedEnvelope(snoozeDueEnvelope(intent)!)!;
  return { snapshot: { tenant_id:'tenant-a',deployment_id:'deployment',authority_revision:1,coordinator_id:'coordinator',max_reservations:64,authority_max_age_ms:60000,policy_id:'policy',policy_revision:1,policy_json:'{}',reservation_namespace:'namespace',restriction_json:'{}' }, expiresAt:2000000000000,
    purpose: intent.family === 'read' ? intent.input.purpose : 'new-work',operationId,operationFingerprint,
    grant:{tenantId:'tenant-a',aggregateId:'aggregate',reservationId:'reservation',holderId:'holder',operationId,operationFingerprint,operationEnvelope} };
}
describe('snooze due exact intent', () => {
  it('funds actual population beyond twenty with checked arithmetic', () => {
    expect(snoozeDueEnvelope(advance)?.d1RowsRead).toBe(5380+8*37);
    expect(snoozeDueEnvelope({...advance,input:{...input,activeSnoozeSnapshot:Number.MAX_SAFE_INTEGER}})).toBeNull();
  });
  it('accepts exact operation including warm controls', async () => {
    await expect(assertSnoozeDueAuthority('tenant-a',advance,await authority(advance))).resolves.toBeUndefined();
  });
  it.each(['expectedGeneration','stepId','dueThrough','activeSnoozeSnapshot'] as const)('binds %s independently', async key => {
    const changes = { expectedGeneration:1,stepId:'b3200000-0000-4000-8000-000000000001',dueThrough:'2026-09-13T19:00:00.000Z',activeSnoozeSnapshot:36 };
    await expect(assertSnoozeDueAuthority('tenant-a',{family:'advance',input:{...input,[key]:changes[key]}},await authority(advance))).rejects.toThrow();
  });
  it('rejects read grants and different tenant for advance', async () => {
    const read = {family:'read',input:{readId:input.stepId,purpose:'new-work'}} as const;
    await expect(assertSnoozeDueAuthority('tenant-a',advance,await authority(read))).rejects.toThrow();
    await expect(assertSnoozeDueAuthority('tenant-b',advance,await authority(advance))).rejects.toThrow();
  });
  it('binds recovery read purpose', async () => {
    const read = {family:'read',input:{readId:input.stepId,purpose:'recovery'}} as const;
    await expect(assertSnoozeDueAuthority('tenant-a',read,await authority(read))).resolves.toBeUndefined();
    await expect(assertSnoozeDueAuthority('tenant-a',{...read,input:{...read.input,purpose:'new-work'}},await authority(read))).rejects.toThrow();
  });
  it('rejects underfunded and overflowing advance before SQL', async () => {
    const prepare=vi.fn(), db={prepare} as unknown as D1Database;
    const repo = new SnoozeDueCheckpointRepository(db,createSystemTenantScope({tenantId:'tenant-a',actor:'scheduled-snooze-resurface'}));
    const admitted=await authority(advance);
    const short={...admitted,grant:{...admitted.grant!,operationEnvelope:{...admitted.grant!.operationEnvelope,d1RowsRead:1}}};
    await expect(repo.advance(input,short)).rejects.toThrow();
    await expect(repo.advance({...input,activeSnoozeSnapshot:Number.MAX_SAFE_INTEGER},admitted)).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it('enforces UTF8 bytes rather than characters for newly journaled identity', async () => {
    const admitted = await authority(advance);
    await expect(assertSnoozeDueAuthority('tenant-a', advance, { ...admitted,
      grant: { ...admitted.grant!, holderId: 'é'.repeat(81) } })).rejects.toThrow();
    await expect(assertSnoozeDueAuthority('tenant-a', advance, { ...admitted,
      grant: { ...admitted.grant!, holderId: 'é'.repeat(80) } })).resolves.toBeUndefined();
  });
  it('rejects unknown envelope keys before journal serialization', async () => {
    const admitted = await authority(advance);
    await expect(assertSnoozeDueAuthority('tenant-a', advance, { ...admitted,
      grant: { ...admitted.grant!, operationEnvelope: Object.assign({}, admitted.grant!.operationEnvelope, { unsupported: 1 }) } })).rejects.toThrow();
  });
  it('keeps due-only row overreservation independent of generic cache constants', () => {
    expect(snoozeDueEnvelope(advance)).toMatchObject({ doRowsRead: 512, doRowsWritten: 512, d1StorageBytes: 8192 });
  });

});
