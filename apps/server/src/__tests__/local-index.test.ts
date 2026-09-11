import localConfig from '../../wrangler.local.json';
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

  it('accepts only configured loopback browser origins for API preflight', async () => {
    for (const origin of ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'https://hostile.example.invalid']) {
      const result = await localWorker.fetch(new Request('http://localhost:8787/api/v1/customer/config', {
        method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      }), { ...localConfig.vars } as any, context);
      expect(result.headers.get('access-control-allow-origin')).toBe(origin.startsWith('https:') ? null : origin);
    }
  });

  it('does not add capture routes to the shared application used by normal Worker entrypoints', async () => {
    expect((await app.request(new Request('http://localhost:8787/__local/auth-capture/messages'), undefined, localEnv)).status).toBe(404);
  });

  it('rejects a non-local runtime even when a caller supplies an in-memory clock capability', async () => {
    const result = await localWorker.fetch(new Request('http://localhost:8787/health?LOCAL_TEST_CLOCK_MS=0'), {
      ENVIRONMENT: 'production', localNow: () => 0,
    } as any, context);
    expect(result.status).toBe(503);
  });

  it('permits one validated temporary loopback origin for an isolated rehearsal', async () => {
    const env = { ...localEnv, LOCAL_RUNTIME_ORIGIN: 'http://127.0.0.1:49152' } as any;
    expect((await localWorker.fetch(new Request('http://127.0.0.1:49152/health'), env, context)).status).toBe(200);
    expect((await localWorker.fetch(new Request('http://localhost:8787/health'), env, context)).status).toBe(403);
    for (const invalid of ['https://127.0.0.1:49152', 'http://example.test:49152', 'http://127.0.0.1:0', 'http://127.0.0.1:49152/path']) {
      expect((await localWorker.fetch(new Request('http://localhost:8787/health'), { ...localEnv, LOCAL_RUNTIME_ORIGIN: invalid } as any, context)).status).toBe(403);
    }
  });
});
