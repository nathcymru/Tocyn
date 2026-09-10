import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import type { Env } from '../src/bindings';
import type { AppVariables } from '../src/types';
import { operationalObservability } from '../src/middleware/operational-observability';
import { createLocalObservabilityCollector } from '../src/observability/local-collector';

test('a synthetic local HTTP flow exports bounded allowlisted evidence without changing its response', async () => {
  const collector = createLocalObservabilityCollector({ maxEvents: 2, maxBytes: 2_048 });
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.use('*', (context, next) => operationalObservability(context, next, collector.record));
  app.get('/health', context => context.text('ok'));
  const env = { ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence' } as Env;
  for (let index = 0; index < 3; index++) {
    const response = await app.request('/health', { headers: { authorization: 'Bearer synthetic-secret' } }, env);
    assert.equal(response.status, 200);
  }
  const exported = collector.export();
  assert.equal(exported.complete, false);
  assert.deepEqual(exported.counts, { attempted: 3, retained: 2, retainedBytes: exported.counts.retainedBytes, invalid: 0, sampledOut: 0, eventLimitDrops: 1, byteLimitDrops: 0 });
  assert.deepEqual(exported.events.map(event => event.type === 'http.request' ? [event.type, event.route, event.method, event.status] : [event.type]), [
    ['http.request', '/health', 'GET', 200], ['http.request', '/health', 'GET', 200],
  ]);
  assert.equal(JSON.stringify(exported).includes('synthetic-secret'), false);
});
