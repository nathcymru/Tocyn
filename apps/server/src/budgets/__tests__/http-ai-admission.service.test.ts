import { describe, expect, it, vi } from 'vitest';
import { STAFF_SUGGESTION_AI_ENVELOPE, WIDGET_CHAT_AI_ENVELOPE, admitHttpAi } from '../http-ai-admission.service';

const scope = { tenantId: 'tenant-a', actorId: 'customer-a', roles: ['customer'], authVersion: 7 } as any;
const payload = { sub: 'customer-a', tenant_id: 'tenant-a', role: 'customer', email: 'customer@example.test',
  session_version: 7, exp: 2_000_000_000, mfa_verified: false, iat: 1 } as any;
const deps = { scope, database: {}, repositories: { budgetAuthority: {} } } as any;

describe('HTTP AI admission', () => {
  it('reserves one bounded embedding/query and the documented maximum generation work', () => {
    expect(WIDGET_CHAT_AI_ENVELOPE).toMatchObject({ workerRequests: 1, d1RowsRead: 2_560, r2ClassBOperations: 3,
      vectorQueriedDimensions: 1_024, aiMicroNeurons: 252_033_792 });
    expect(STAFF_SUGGESTION_AI_ENVELOPE).toMatchObject({ workerRequests: 1, d1RowsRead: 2_560, r2ClassBOperations: 5,
      vectorQueriedDimensions: 1_024, aiMicroNeurons: 290_509_056 });
  });

  it('does not consult authority or any provider for explicit AI-off mode', async () => {
    const authority = vi.fn();
    const outcome = await admitHttpAi({ env: { BUDGET_ADMISSION_POLICY: 'off', AI: { run: authority }, VECTOR_INDEX: { query: authority },
      ATTACHMENTS_BUCKET: { get: authority } } as any, deps, payload, operation: 'widget.chat', now: () => 1_000 });
    expect(outcome).toEqual({ status: 'disabled' });
    expect(authority).not.toHaveBeenCalled();
  });

  it('rejects an unconfigured or API-only boundary before any resource work', async () => {
    const provider = vi.fn();
    const outcome = await admitHttpAi({ env: { BUDGET_ADMISSION_POLICY: 'api-ticket-mutations-v1', AI: { run: provider },
      VECTOR_INDEX: { query: provider }, ATTACHMENTS_BUCKET: { get: provider } } as any,
    deps, payload, operation: 'widget.chat', now: () => 1_000 });
    expect(outcome).toEqual({ status: 'rejected', reason: 'unavailable' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects a mismatched current tenant selector before an admission or provider call', async () => {
    const provider = vi.fn();
    const outcome = await admitHttpAi({ env: { BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: {},
      AI: { run: provider }, VECTOR_INDEX: { query: provider }, ATTACHMENTS_BUCKET: { get: provider } } as any,
    deps, payload: { ...payload, tenant_id: 'tenant-b' }, operation: 'widget.chat', now: () => 1_000 });
    expect(outcome).toEqual({ status: 'rejected', reason: 'unavailable' });
    expect(provider).not.toHaveBeenCalled();
  });
});
