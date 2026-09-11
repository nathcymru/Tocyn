import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createDeps: vi.fn(),
  aiConstructor: vi.fn(),
  knowledgeConstructor: vi.fn(),
  emit: vi.fn(),
  index: {} as Record<string, ReturnType<typeof vi.fn>>,
  admit: vi.fn(),
  service: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {
    constructor(public env: unknown) {}
  },
}));

vi.mock('../../middleware/tenant.middleware', () => ({
  createTenantRequestDeps: state.createDeps,
}));

vi.mock('../../services/ai.service', () => ({
  StatelessAiService: class {
    constructor(...args: unknown[]) {
      state.aiConstructor(...args);
    }
  },
}));

vi.mock('../../services/tenant-knowledge.service', () => ({
  TenantKnowledgeService: class {
    constructor(...args: unknown[]) {
      state.knowledgeConstructor(...args);
      return state.service;
    }
  },
}));
vi.mock('../../repositories/knowledge-index.repository', () => ({
  KnowledgeIndexRepository: class { constructor() { return state.index; } },
}));
vi.mock('../../budgets/knowledge-index-admission.service', () => ({
  admitKnowledgeIndexChunk: (...args: unknown[]) => state.admit(...args),
}));

import { VectorizeWorkflow } from '../vectorize.workflow';

const job = { tenantId: 'synthetic-tenant', action: 'index' as const, documentId: 'private-document', version: 1 };
const run = (env: Record<string, unknown>, step: { do: ReturnType<typeof vi.fn> }) =>
  (new VectorizeWorkflow(env as never) as never as { run: (event: { payload: typeof job }, step: unknown) => Promise<void> })
    .run({ payload: job }, step);

describe('VectorizeWorkflow', () => {
  beforeEach(() => {
    state.emit = vi.fn();
    state.createDeps.mockReset().mockReturnValue({ emitResourceOperation: state.emit });
    state.aiConstructor.mockReset();
    state.knowledgeConstructor.mockReset();
    state.index = { next: vi.fn().mockResolvedValue(0), completeIfFinished: vi.fn(), reserveDispatch: vi.fn().mockResolvedValue(true), reserveDocumentCleanupDispatch: vi.fn().mockResolvedValue(false) };
    state.admit.mockReset().mockResolvedValue({ status: 'admitted' });
    state.service = {
      indexManifestChunk: vi.fn().mockResolvedValue('complete'),
    };
  });

  it('runs an enabled test-environment job and records only the Workflow invocation metadata', async () => {
    const step = { do: vi.fn(async (_name: string, callback: () => Promise<void>) => callback()) };
    await expect(run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' }, step)).resolves.toBeUndefined();

    expect(step.do).toHaveBeenCalledTimes(1);
    expect(state.service.indexManifestChunk).toHaveBeenCalledWith('private-document', 1, 0);
    expect(state.aiConstructor).toHaveBeenCalledWith({}, state.emit);
    expect(state.emit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'workflow', operation: 'run', outcome: 'success' }));
    expect(JSON.stringify(state.emit.mock.calls)).not.toMatch(/synthetic-tenant|private-document/);
  });

  it('keeps local-beta workflow rejection ahead of dependency construction and step invocation', async () => {
    const step = { do: vi.fn() };
    await expect(run({ AI: {}, ENVIRONMENT: 'test', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence' }, step))
      .rejects.toThrow('Vector workflows are disabled in the local beta');

    expect(state.createDeps).not.toHaveBeenCalled();
    expect(step.do).not.toHaveBeenCalled();
    expect(state.emit).not.toHaveBeenCalled();
  });

  it('preserves the exact step failure without retries while measuring failure', async () => {
    const failure = new Error('private provider state');
    const step = { do: vi.fn().mockRejectedValue(failure) };
    await expect(run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' }, step)).rejects.toBe(failure);

    expect(step.do).toHaveBeenCalledTimes(1);
    expect(state.service.indexManifestChunk).not.toHaveBeenCalled();
    expect(state.emit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'workflow', operation: 'run', outcome: 'failure' }));
    expect(JSON.stringify(state.emit.mock.calls)).not.toContain('private provider state');
  });

  it('records a cached step invocation even when its callback is not run', async () => {
    const step = { do: vi.fn().mockResolvedValue(undefined) };
    await expect(run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' }, step)).resolves.toBeUndefined();

    expect(step.do).toHaveBeenCalledWith('apply_scoped_vectorization', expect.any(Function));
    expect(state.service.indexManifestChunk).not.toHaveBeenCalled();
    expect(state.emit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'workflow', operation: 'run', outcome: 'success' }));
  });

  it('does not invoke a provider path when the manifest outcome is stale', async () => {
    state.service.indexManifestChunk.mockResolvedValue('stale');
    const step = { do: vi.fn(async (_name: string, callback: () => Promise<void>) => callback()) };
    await run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' }, step);

    expect(state.service.indexManifestChunk).toHaveBeenCalledWith('private-document', 1, 0);
  });

  it('records the bounded next-dispatch claim before surfacing a lost schedule acknowledgement', async () => {
    state.service.indexManifestChunk.mockResolvedValue('next');
    const create = vi.fn().mockRejectedValue(new Error('synthetic lost schedule acknowledgement'));
    const step = { do: vi.fn(async (_name: string, callback: () => Promise<void>) => callback()) };
    await expect(run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence', VECTORIZE_WORKFLOW: { create } }, step))
      .rejects.toThrow('synthetic lost schedule acknowledgement');
    expect(state.admit).toHaveBeenCalledTimes(1);
    expect(state.service.indexManifestChunk).toHaveBeenCalledTimes(1);
    expect(state.index.reserveDispatch).toHaveBeenCalledWith('private-document', 1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
