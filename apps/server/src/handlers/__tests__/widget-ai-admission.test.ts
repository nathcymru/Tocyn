import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import widget from '../widget.handler';
import { WidgetKnowledgeReader } from '../../services/tenant-knowledge.service';
import { IsolateBudgetAdmissionCache } from '../../budgets/isolate-admission.service';

const secret = 'test-secret-key-at-least-32-chars-long-123456';
const db = {
  prepare: vi.fn().mockReturnThis(), bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue({ id: 'customer-a', email: 'customer@example.test', role: 'customer', session_version: 7 }),
  all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn(), batch: vi.fn(),
};

async function customerToken() {
  return new jose.SignJWT({ sub: 'customer-a', tenant_id: 'tenant-a', email: 'customer@example.test', role: 'customer', session_version: 7 })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('widget').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

describe('widget AI admission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the deterministic fallback before embedding, Vectorize, or R2 when AI is off', async () => {
    const search = vi.spyOn(WidgetKnowledgeReader.prototype, 'search');
    const aiRun = vi.fn();
    const vectorQuery = vi.fn();
    const r2Get = vi.fn();
    const response = await widget.request('/chat', { method: 'POST', headers: {
      authorization: `Bearer ${await customerToken()}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ message: 'Where is my answer?' }) }, {
      BUDGET_ADMISSION_POLICY: 'off', DB: db as any, JWT_SECRET: secret,
      AI: { run: aiRun }, VECTOR_INDEX: { query: vectorQuery }, ATTACHMENTS_BUCKET: { get: r2Get },
    } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ response: "I'm having trouble connecting to my brain. Please try again later." });
    expect(search).not.toHaveBeenCalled();
    expect(aiRun).not.toHaveBeenCalled();
    expect(vectorQuery).not.toHaveBeenCalled();
    expect(r2Get).not.toHaveBeenCalled();
  });

  it('uses the same no-resource fallback when the configured boundary cannot admit AI', async () => {
    const search = vi.spyOn(WidgetKnowledgeReader.prototype, 'search');
    const provider = vi.fn();
    const response = await widget.request('/chat', { method: 'POST', headers: {
      authorization: `Bearer ${await customerToken()}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ message: 'Where is my answer?' }) }, {
      BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DB: db as any, JWT_SECRET: secret,
      AI: { run: provider }, VECTOR_INDEX: { query: provider }, ATTACHMENTS_BUCKET: { get: provider },
    } as any);
    expect(response.status).toBe(200);
    expect(search).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps an admitted provider failure charged and does not retry it', async () => {
    const admission = vi.spyOn(IsolateBudgetAdmissionCache.prototype, 'admit').mockResolvedValue({ status: 'spent' } as any);
    const aiRun = vi.fn().mockRejectedValue(new Error('synthetic provider failure'));
    const response = await widget.request('/chat', { method: 'POST', headers: {
      authorization: `Bearer ${await customerToken()}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ message: 'Where is my answer?' }) }, {
      BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', DB: db as any, JWT_SECRET: secret,
      BUDGET_COORDINATOR_DO: {}, AI: { run: aiRun }, VECTOR_INDEX: { query: vi.fn() }, ATTACHMENTS_BUCKET: { get: vi.fn() },
    } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ response: "I'm having trouble connecting to my brain. Please try again later." });
    expect(admission).toHaveBeenCalledTimes(1);
    expect(aiRun).toHaveBeenCalledTimes(1);
  });
});
