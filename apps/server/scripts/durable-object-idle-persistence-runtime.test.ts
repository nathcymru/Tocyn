import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Explicit native acceptance only. A simulated clock cannot exercise idle eviction.
// No external DO stub is retained across idle: retaining one can pin an actor.
const script = `import { DurableObject } from 'cloudflare:workers';
export class Counter extends DurableObject {
  async increment() {
    const next = (await this.ctx.storage.get('counter') ?? 0) + 1;
    await this.ctx.storage.put('counter', next);
    return next;
  }
}
export default { async fetch(request, env) {
  return Response.json({ counter: await env.COUNTER.get(env.COUNTER.idFromName('synthetic')).increment() });
} };`;

test('local disk DO storage retains authority counters across real idle eviction', { timeout: 90_000 }, async () => {
  const persistence = await mkdtemp(join(tmpdir(), 'tocyn-idle-persistence-'));
  const mf = new Miniflare(convertV4MiniflareOptions({ resourcePersistencePath: persistence, workers: [{
    name: 'persistent-idle-proof', modules: true, script, compatibilityDate: '2024-04-03',
    durableObjects: { COUNTER: 'Counter' }, unsafeEphemeralDurableObjects: false,
  }] }));
  try {
    const before = await (await mf.dispatchFetch('http://synthetic.test')).json() as { counter: number };
    assert.equal(before.counter, 1);
    for (let tick = 0; tick < 13; tick++) await new Promise(resolve => setTimeout(resolve, 5_000));
    const after = await (await mf.dispatchFetch('http://synthetic.test')).json() as { counter: number };
    assert.equal(after.counter, 2, 'idle must not reset a durable reservation sequence');
  } finally {
    await mf.dispose();
    await rm(persistence, { recursive: true, force: true });
  }
});
