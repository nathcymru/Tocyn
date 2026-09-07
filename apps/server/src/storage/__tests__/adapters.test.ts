import { describe, it, expect, vi } from 'vitest';
import { createVerifiedTenantScope } from '../../auth/scope';
import { TenantR2Adapter, TenantVectorStorage } from '../adapters';
import { createHash } from 'crypto';

describe('Tenant Storage Adapters', () => {
  const scopeA = createVerifiedTenantScope('tenant-A', 'user-1', ['agent'], 1);

  it('R2 adapter prepends tenant namespace', async () => {
    const mockBucket = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const r2 = new TenantR2Adapter(scopeA, mockBucket);

    await r2.get('file.png');
    expect(mockBucket.get).toHaveBeenCalledWith('tenant-A/file.png');

    await r2.put('tenant-B/file.png', 'data');
    expect(mockBucket.put).toHaveBeenCalledWith('tenant-A/tenant-B/file.png', 'data', undefined);

    await r2.delete('file.png');
    expect(mockBucket.delete).toHaveBeenCalledWith('tenant-A/file.png');
  });

  it('Vectorize adapter derives namespace and ID safely', async () => {
    const mockIndex = {
  upsert: vi.fn(),
  getByIds: vi.fn().mockResolvedValue([{ id: 'c7d2ddce33a08d4f733f272e22dbb3b8c9e9f38c586eb7dd5f0949ecc6d3bf48', metadata: { _logical_id: 'doc-1', tenant_id: 'tenant-A' } }]),
  deleteByIds: vi.fn(),
  query: vi.fn()
};
    const vec = new TenantVectorStorage(scopeA, mockIndex);

    const expectedNamespace = 't_' + createHash('sha256').update('tenant-A').digest('base64url');
    const expectedId = createHash('sha256').update('tenant-A\0doc-1').digest('hex');

    await vec.upsert('doc-1', [0.1, 0.2]);
    expect(mockIndex.upsert).toHaveBeenCalledWith([expect.objectContaining({
      id: expectedId,
      values: [0.1, 0.2],
      namespace: expectedNamespace
    })]);

    await vec.getByIds(['doc-1']);
    expect(mockIndex.getByIds).toHaveBeenCalledWith([expectedId]);

    await vec.query([0.1, 0.2]);
    expect(mockIndex.query).toHaveBeenCalledWith([0.1, 0.2], { namespace: expectedNamespace });

    await vec.delete('doc-1');
    expect(mockIndex.deleteByIds).toHaveBeenCalledWith([expectedId]);
  });
});

describe('Article body hydration', () => {
  it('prefers scoped objects even for legacy-shaped logical keys and cancels bounded reads', async () => {
    const { TenantArticleBodyHydrator } = await import('../adapters');
    const cancel = vi.fn();
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('scoped-content')); }, cancel });
    const legacy = { getLegacyUnscopedAttachment: vi.fn() };
    const scoped = { getAttachment: vi.fn().mockResolvedValue({body: stream}) };
    const result = await new TenantArticleBodyHydrator(scoped as any, legacy as any).hydrate(null, 'tickets/1/articles/2/body.txt', 6);
    expect(result).toBe('scoped');
    expect(cancel).toHaveBeenCalledOnce();
    expect(legacy.getLegacyUnscopedAttachment).not.toHaveBeenCalled();
  });

  it('does not request raw legacy storage for a normal tenant', async () => {
    const { TenantArticleBodyHydrator } = await import('../adapters');
    const scoped = {getAttachment: vi.fn().mockResolvedValue(null)};
    expect(await new TenantArticleBodyHydrator(scoped as any).hydrate(null,'tickets/1/articles/2/body.txt')).toBe('[Legacy article body unavailable]');
  });
});
