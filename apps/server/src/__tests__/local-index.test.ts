import { describe, expect, it } from 'vitest';
import localWorker from '../local-index';
import { app } from '../application';

const context = {} as ExecutionContext;
const localEnv = { ENVIRONMENT: 'local' } as any;

describe('local-only capture entrypoint', () => {
  it('serves only capture JSON controls on loopback and resets in-memory state', async () => {
    const messages = await localWorker.fetch(new Request('http://localhost:8787/__local/auth-capture/messages'), localEnv, context);
    expect(messages.status).toBe(200);
    expect(await messages.json()).toEqual([]);
    expect((await localWorker.fetch(new Request('http://localhost:8787/__local/auth-capture'), localEnv, context)).status).toBe(404);
    expect((await localWorker.fetch(new Request('http://localhost:8787/__local/auth-capture/reset', { method: 'POST', headers: { Origin: 'http://localhost:5174' } }), localEnv, context)).status).toBe(204);
    expect((await localWorker.fetch(new Request('http://localhost:8787/__local/auth-capture/reset', { method: 'POST', headers: { Origin: 'http://attacker.example' } }), localEnv, context)).status).toBe(403);
    expect((await localWorker.fetch(new Request('http://example.test/__local/auth-capture/messages'), localEnv, context)).status).toBe(403);
  });

  it('does not add capture routes to the shared application used by normal Worker entrypoints', async () => {
    expect((await app.request(new Request('http://localhost:8787/__local/auth-capture/messages'), undefined, localEnv)).status).toBe(404);
  });
});
