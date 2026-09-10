import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { BroadcastService } from '../src/services/broadcast.service';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { createResourceOperationEmitter } from '../src/observability/resource-operation';

test('real Miniflare Durable Object fetch emits bounded local resource evidence', async () => {
  const bundled = await build({ entryPoints: ['src/durable_objects/NotificationDO.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false });
  let mf: Miniflare | undefined;
  const originalLog = console.log;
  try {
    const script = bundled.outputFiles[0].text;
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'do-resource-proof', modules: true, script,
      durableObjects: { NOTIFICATION_DO: 'NotificationDO' }, unsafeEphemeralDurableObjects: true }] }));
    const namespace = await mf.getDurableObjectNamespace('NOTIFICATION_DO');
    const events: unknown[] = [];
    console.log = (message?: unknown) => { events.push(JSON.parse(String(message))); };
    const env = { NOTIFICATION_DO: namespace } as any;
    const emitter = createResourceOperationEmitter({ ENVIRONMENT: 'preview', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence' });
    const broadcast = new BroadcastService(env, createVerifiedTenantScope('runtime-tenant', 'runtime-agent', ['agent'], 1), emitter);
    await broadcast.broadcast('runtime.proof', { private: 'payload' });
    assert.equal(events.length, 1);
    const event = events[0] as any;
    assert.equal(event.version, 1); assert.equal(event.type, 'resource.operation');
    assert.equal(event.resource, 'durable_object'); assert.equal(event.operation, 'invoke');
    assert.equal(event.outcome, 'success'); expectFinite(event.latencyMs);
    assert.equal(JSON.stringify(events).includes('private'), false);
    const beforeProduction = events.length;
    const productionEmitter = createResourceOperationEmitter({ ENVIRONMENT: 'production', LOCAL_BETA_ENABLED: 'true', OBSERVABILITY_MODE: 'isolated-evidence' });
    await new BroadcastService(env, createVerifiedTenantScope('runtime-tenant', 'runtime-agent', ['agent'], 1), productionEmitter).broadcast('runtime.production', { private: 'payload' });
    assert.equal(events.length, beforeProduction);
  } finally { console.log = originalLog; await mf?.dispose(); }
});

function expectFinite(value: any): void { assert.equal(typeof value, 'number'); assert.ok(Number.isFinite(value)); }
