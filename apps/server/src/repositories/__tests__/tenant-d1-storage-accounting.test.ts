import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from '../../../scripts/split-sql';
import { createVerifiedTenantScope } from '../../auth/scope';
import { MAX_TENANT_D1_STORAGE_ENVELOPE_BYTES, TenantD1StorageAccountingRepository } from '../tenant-d1-storage-accounting.repository';

const root = resolve(import.meta.dirname, '../../..');
const miniflares: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(miniflares.splice(0).map(instance => instance.dispose()));
});

async function accounting() {
  const miniflare = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'tenant-storage-accounting', modules: true, compatibilityDate: '2024-04-03',
    script: 'export default { fetch() { return new Response("ok") } }', d1Databases: { DB: 'tenant-storage-accounting' },
  }] }));
  miniflares.push(miniflare);
  const db = await miniflare.getD1Database('DB');
  for (const migration of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
  }
  return (tenantId: string) => new TenantD1StorageAccountingRepository(db, createVerifiedTenantScope(tenantId, 'actor', ['system'], 1));
}

const allocation = (ceilingBytes = 100, revision = 1) => ({ ceilingBytes, revision });
const reserve = (operationId: string, envelopeBytes: number, revision = 1) => ({
  operationId, operationFingerprint: `fingerprint:${operationId}`, envelopeBytes, allocation: allocation(100, revision), now: 1,
});

describe('tenant D1 storage accounting', () => {
  it('holds bounded storage envelopes atomically and idempotently per tenant', async () => {
    const repository = await accounting();
    const a = repository('tenant-a');
    const b = repository('tenant-b');
    expect((await a.reserve(reserve('customer-credential-create', 60))).status).toBe('reserved');
    expect((await a.reserve(reserve('customer-credential-create', 60))).status).toBe('idempotent');
    expect((await a.reserve(reserve('customer-credential-rotate', 41))).status).toBe('exhausted');
    expect((await b.reserve(reserve('customer-credential-create', 100))).status).toBe('reserved');
    expect(await a.currentSnapshot()).toMatchObject({ allocationBytes: 100, attributedBytes: 0, reservedBytes: 60, uncertainBytes: 0 });
    expect(await b.currentSnapshot()).toMatchObject({ allocationBytes: 100, attributedBytes: 0, reservedBytes: 100, uncertainBytes: 0 });
    expect((await a.reserve({ ...reserve('too-large', MAX_TENANT_D1_STORAGE_ENVELOPE_BYTES + 1), allocation: allocation(MAX_TENANT_D1_STORAGE_ENVELOPE_BYTES + 1) })).status)
      .toBe('unavailable');
  });

  it('keeps an uncertain customer/auth write charged until matching terminal evidence reconciles it', async () => {
    const repository = (await accounting())('tenant-a');
    const operation = reserve('customer-otp-issue', 80);
    expect((await repository.reserve(operation)).status).toBe('reserved');
    expect((await repository.markUncertain(operation.operationId, operation.operationFingerprint, 2)).status).toBe('uncertain');
    expect((await repository.reserve(reserve('customer-password-reset', 21))).status).toBe('exhausted');
    expect((await repository.reconcile({ operationId: operation.operationId, operationFingerprint: operation.operationFingerprint,
      attributedBytes: 30, evidenceId: 'credential-row:tenant-a:customer-otp-issue', now: 3 })).status).toBe('reconciled');
    expect(await repository.currentSnapshot()).toMatchObject({ attributedBytes: 30, reservedBytes: 0, uncertainBytes: 0 });
    expect((await repository.reserve(reserve('customer-password-reset', 70))).status).toBe('reserved');
    expect((await repository.reconcile({ operationId: operation.operationId, operationFingerprint: operation.operationFingerprint,
      attributedBytes: 30, evidenceId: 'credential-row:tenant-a:customer-otp-issue', now: 4 })).status).toBe('idempotent');
    expect((await repository.reconcile({ operationId: operation.operationId, operationFingerprint: operation.operationFingerprint,
      attributedBytes: 31, evidenceId: 'credential-row:tenant-a:customer-otp-issue', now: 4 })).status).toBe('conflict');
  });

  it('fences allocation revisions and refuses an underestimated reconciliation without releasing the reservation', async () => {
    const repository = (await accounting())('tenant-a');
    const operation = reserve('staff-mfa-confirm', 60);
    expect((await repository.reserve(operation)).status).toBe('reserved');
    expect((await repository.reserve({ ...reserve('older-policy', 1), allocation: allocation(100, 0) })).status).toBe('stale-allocation');
    expect((await repository.reserve({ ...reserve('reduced-owner-ceiling', 1), allocation: allocation(50, 2) })).status).toBe('exhausted');
    expect((await repository.reconcile({ operationId: operation.operationId, operationFingerprint: operation.operationFingerprint,
      attributedBytes: 61, evidenceId: 'mfa-row:tenant-a:staff-mfa-confirm', now: 2 })).status).toBe('unavailable');
    expect(await repository.currentSnapshot()).toMatchObject({ allocationBytes: 100, allocationRevision: 1, reservedBytes: 60, attributedBytes: 0 });
    expect((await repository.reserve({ ...reserve('raised-owner-ceiling', 60), allocation: allocation(120, 2) })).status).toBe('reserved');
    expect(await repository.currentSnapshot()).toMatchObject({ allocationBytes: 120, allocationRevision: 2, reservedBytes: 120, attributedBytes: 0 });
  });
});
