import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createDeps: vi.fn(),
  aiConstructor: vi.fn(),
  knowledgeConstructor: vi.fn(),
  emit: vi.fn(),
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

import { VectorizeWorkflow } from '../vectorize.workflow';

const job = { tenantId: 'synthetic-tenant', action: 'create' as const, documentId: 'private-document' };
const run = (env: Record<string, unknown>, step: { do: ReturnType<typeof vi.fn> }) =>
  (new VectorizeWorkflow(env as never) as never as { run: (event: { payload: typeof job }, step: unknown) => Promise<void> })
    .run({ payload: job }, step);

describe('VectorizeWorkflow', () => {
  beforeEach(() => {
    state.emit = vi.fn();
    state.createDeps.mockReset().mockReturnValue({ emitResourceOperation: state.emit });
    state.aiConstructor.mockReset();
    state.knowledgeConstructor.mockReset();
    state.service = {
      getDocument: vi.fn().mockResolvedValue({ status: 'published' }),
      publishDocument: vi.fn().mockResolvedValue(undefined),
      markArticleAsQA: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('runs an enabled test-environment job and records only the Workflow invocation metadata', async () => {
    const step = { do: vi.fn(async (_name: string, callback: () => Promise<void>) => callback()) };
    await expect(run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' }, step)).resolves.toBeUndefined();

    expect(step.do).toHaveBeenCalledTimes(1);
    expect(state.service.getDocument).toHaveBeenCalledWith('private-document');
    expect(state.service.publishDocument).toHaveBeenCalledWith('private-document');
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
    expect(state.service.getDocument).not.toHaveBeenCalled();
    expect(state.emit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'workflow', operation: 'run', outcome: 'failure' }));
    expect(JSON.stringify(state.emit.mock.calls)).not.toContain('private provider state');
  });

  it('records a cached step invocation even when its callback is not run', async () => {
    const step = { do: vi.fn().mockResolvedValue(undefined) };
    await expect(run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' }, step)).resolves.toBeUndefined();

    expect(step.do).toHaveBeenCalledWith('apply_scoped_vectorization', expect.any(Function));
    expect(state.service.getDocument).not.toHaveBeenCalled();
    expect(state.service.publishDocument).not.toHaveBeenCalled();
    expect(state.emit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'workflow', operation: 'run', outcome: 'success' }));
  });

  it('does not republish a document that is no longer published when the callback executes', async () => {
    state.service.getDocument.mockResolvedValue({ status: 'draft' });
    const step = { do: vi.fn(async (_name: string, callback: () => Promise<void>) => callback()) };
    await run({ AI: {}, ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' }, step);

    expect(state.service.getDocument).toHaveBeenCalledWith('private-document');
    expect(state.service.publishDocument).not.toHaveBeenCalled();
  });
});
