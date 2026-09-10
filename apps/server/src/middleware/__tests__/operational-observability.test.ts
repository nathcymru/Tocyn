import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import type { Env } from '../../bindings';
import { operationalObservability } from '../operational-observability';

const enabled = { LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence', ENVIRONMENT: 'test' };
function context(env: Partial<Env>) {
  return { env, req: { path: '/api/auth/secret-magic-link', method: 'POST' }, res: new Response(null, {status: 403}) } as unknown as Context<{Bindings: Env}>;
}
afterEach(() => vi.restoreAllMocks());
describe('optional diagnostics preserve request behavior', () => {
  it.each([{}, enabled])('preserves the original downstream exception with environment %j', async env => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const original = new Error('synthetic request failure');
    await expect(operationalObservability(context(env), async () => { throw original; })).rejects.toBe(original);
  });
  it('does not replace a request exception when the telemetry sink also fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('sink unavailable'); });
    const original = new Error('synthetic authorization failure');
    await expect(operationalObservability(context(enabled), async () => { throw original; })).rejects.toBe(original);
  });
  it('does not turn an ordinary denied response into an exception when diagnostics fail', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('sink unavailable'); });
    const c = context(enabled);
    await expect(operationalObservability(c, async () => {})).resolves.toBeUndefined();
    expect(c.res.status).toBe(403);
    expect(log).toHaveBeenCalledOnce();
  });
  it('emits no diagnostic record when telemetry is off', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await operationalObservability(context({}), async () => {});
    expect(log).not.toHaveBeenCalled();
  });
  it('classifies a thrown failure without serializing its message', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(operationalObservability(context(enabled), async () => { throw new Error('synthetic-sensitive-detail'); })).rejects.toThrow();
    const emitted = JSON.parse(log.mock.calls[0][0]);
    expect(emitted).toMatchObject({status:500, outcome:'server_error', route:'/api/auth'});
    expect(JSON.stringify(emitted)).not.toContain('synthetic-sensitive-detail');
  });
  it('still executes the application when diagnostic initialization fails', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('diagnostic ID unavailable'); });
    const next = vi.fn(async () => {});
    await expect(operationalObservability(context(enabled), next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

});
