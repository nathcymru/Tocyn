import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('current compatibility supports bounded native R2 BYOB reads and fixed-length outbound streaming', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'stream-proof', modules: true,
    compatibilityDate: '2024-04-01', r2Buckets: ['BUCKET'], serviceBindings: { SINK: 'stream-sink' },
    script: `export default {async fetch(request,env) {
      const size=100003; await env.BUCKET.put('synthetic',new Uint8Array(size));
      const object=await env.BUCKET.get('synthetic');
      const reader=object.body.getReader({mode:'byob'});
      const {readable,writable}=new FixedLengthStream(size);
      const writer=writable.getWriter(); let reads=0,maxChunk=0;
      const pump=(async()=>{for(;;){const result=await reader.readAtLeast(49152,new Uint8Array(49152));
        if(result.done)break; reads++;maxChunk=Math.max(maxChunk,result.value.byteLength);await writer.write(result.value);
      }await writer.close();})();
      const response=await env.SINK.fetch(new Request('https://synthetic.test/',{method:'POST',body:readable}));
      await pump;return Response.json({...(await response.json()),reads,maxChunk});
    }}` }, { name: 'stream-sink', modules: true, compatibilityDate: '2024-04-01',
    script: `export default {async fetch(request){let bytes=0;for await(const chunk of request.body)bytes+=chunk.byteLength;
      return Response.json({bytes,length:request.headers.get('content-length')});}}` }] }));
  try {
    const result = await (await mf.dispatchFetch('https://proof.test/')).json() as any;
    assert.deepEqual(result, { bytes: 100003, length: '100003', reads: 3, maxChunk: 49152 });
  } finally { await mf.dispose(); }
});
