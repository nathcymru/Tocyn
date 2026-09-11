import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';

const serverRoot = resolve(import.meta.dirname, '..');
test('ticket source streaming is bounded, exact, isolated and recovers permits after rejection', { timeout: 45000 }, async () => {
  const bundle = await build({ absWorkingDir: serverRoot, entryPoints: ['scripts/email-ticket-stream-runtime-entry.ts'],
    bundle: true, write: false, platform: 'neutral', format: 'esm' });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'ticket-stream', modules: true,
    compatibilityDate: '2024-04-01', script: bundle.outputFiles[0].text,
    r2Buckets: ['BUCKET'], serviceBindings: { SINK: 'ticket-sink' } },
  { name: 'ticket-sink', modules: true, compatibilityDate: '2024-04-01', script: `export default {async fetch(request) {
    if(new URL(request.url).pathname==='/hold')await new Promise(resolve=>setTimeout(resolve,500));
    if(new URL(request.url).pathname==='/reject')return new Response('private body',{status:503});
    let bytes=0;const chunks=[];const capture=Number(request.headers.get('content-length'))<4096;
    for await(const chunk of request.body){bytes+=chunk.byteLength;if(capture)chunks.push(...chunk);}
    if(new URL(request.url).pathname==='/response-stall'){
      let timer; return new Response(new ReadableStream({start(controller){timer=setTimeout(()=>{controller.enqueue(new TextEncoder().encode('{"id":"too-late"}'));controller.close();},35000);},cancel(){clearTimeout(timer);}}));
    }
    if(new URL(request.url).pathname==='/large-response')return new Response('x'.repeat(16385));
    if(new URL(request.url).pathname==='/bad-response')return new Response('invalid private JSON');
    return Response.json({id:'synthetic-delivery',bytes,length:request.headers.get('content-length'),
      body:capture?new TextDecoder().decode(new Uint8Array(chunks)):undefined});
  }}` }] }));
  try {
    // Miniflare's prerelease binding proxy types currently infer Request here.
    const bucket = await mf.getR2Bucket('BUCKET') as unknown as R2Bucket;
    for (const tenant of ['A', 'B']) for (let i = 0; i < 10; i++) {
      await bucket.put(`${tenant}/file-${i}`, new Uint8Array([tenant === 'A' ? 1 : 2, 3, 4, 5, 6]), { httpMetadata: { contentType: 'text/plain' } });
    }
    await bucket.put('A/short-body', new Uint8Array(4), { httpMetadata: { contentType: 'text/plain' } });
    await bucket.put('A/long-body', new Uint8Array(6), { httpMetadata: { contentType: 'text/plain' } });
    const send = async (query = '') => await (await mf.dispatchFetch(`https://fixture.test/send?${query}`)).json() as any;
    const a = await send('tenant=A'); const b = await send('tenant=B');
    for (const result of [a, b]) {
      assert.equal(result.outcome, 'accepted'); assert.equal(result.metrics.arrayBuffers, 0);
      assert.equal(result.metrics.peakReaders, 1); assert.equal(result.metrics.activeReaders, 0);
      assert.equal(result.metrics.gets, 2); assert.equal(result.metrics.providerCalls, 1);
      assert.equal(result.sink.bytes, Number(result.sink.length));
    }
    const bodyA = JSON.parse(a.sink.body), bodyB = JSON.parse(b.sink.body);
    assert.equal(bodyA.html, '<p>Text &quot; quoted<br>\\ and 😀</p>');
    assert.equal(bodyA.text, 'Text " quoted\n\\ and 😀');
    assert.equal(bodyA.subject, '[#1] Subject 漢😀');
    assert.equal(bodyA.attachments[0].content, Buffer.from([1, 3, 4, 5, 6]).toString('base64'));
    assert.equal(bodyB.attachments[0].content, Buffer.from([2, 3, 4, 5, 6]).toString('base64'));
    assert.equal(bodyA.attachments.length, 2);

    const first = send('mode=hold'); const second = send('mode=hold');
    for (let i = 0; i < 100; i++) {
      const status = await (await mf.dispatchFetch('https://fixture.test/pending')).json() as any;
      if (status.pending === 2) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const busy = await send(); assert.equal(busy.outcome, 'busy');
    assert.equal(busy.metrics.gets, 0); assert.equal(busy.metrics.providerCalls, 0);
    assert.equal((await first).outcome, 'accepted'); assert.equal((await second).outcome, 'accepted');
    for (const mode of ['reject', 'metadata', 'bad-response', 'large-response', 'missing', 'unsupported', 'short-body', 'long-body', 'read-error']) {
      const failed = await send(`mode=${mode}`); assert.equal(failed.outcome, 'failed');
      assert.equal(failed.metrics.activeReaders, 0); assert.ok(failed.metrics.providerCalls <= 1);
      assert.doesNotMatch(failed.message, /private|synthetic-no-provider-key|file-/);
      assert.equal((await send()).outcome, 'accepted', `permit must recover after ${mode}`);
    }

    // Ten accepted 2MiB attachments, with the receiver counting and discarding
    // chunks. Neither production source nor sink buffers the full message.
    for (let i = 0; i < 10; i++) await bucket.put(`A/file-${i}`, new Uint8Array(2 * 1024 * 1024), { httpMetadata: { contentType: 'text/plain' } });
    const large = await send(`tenant=A&count=10&size=${2 * 1024 * 1024}`);
    assert.equal(large.outcome, 'accepted'); assert.equal(large.metrics.gets, 10);
    assert.equal(large.metrics.peakReaders, 1); assert.equal(large.metrics.maxInput, 48 * 1024);
    assert.equal(large.metrics.arrayBuffers, 0); assert.equal(large.sink.bytes, Number(large.sink.length));
    assert.ok(large.sink.bytes > 27_000_000);

    const started = Date.now();
    const timedOut = await send(`mode=response-stall&count=1&size=${2 * 1024 * 1024}`);
    assert.equal(timedOut.outcome, 'failed');
    assert.equal(timedOut.metrics.activeReaders, 0);
    assert.ok(Date.now() - started < 34000, 'deadline cancels a pending native provider response read');
    assert.equal((await send(`count=1&size=${2 * 1024 * 1024}`)).outcome, 'accepted');
  } finally { await mf.dispose(); }
});
