import { describe, expect, it, vi } from 'vitest';
import { MAX_INBOUND_RAW_BYTES, MAX_INBOUND_RAW_CHUNKS, readBoundedInboundRaw } from '../inbound-raw';

describe('bounded inbound preparation',()=>{
  it.each([0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,MAX_INBOUND_RAW_BYTES+1])('rejects declared size %s before locking the stream',async size=>{
    const stream = new ReadableStream<Uint8Array>();
    const reader = vi.spyOn(stream,'getReader');
    await expect(readBoundedInboundRaw(stream,size)).rejects.toThrow('size');
    expect(reader).not.toHaveBeenCalled();
  });

  it('copies fragmented binary data exactly and releases its reader',async()=>{
    const stream = new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([0,255]));c.enqueue(new Uint8Array([1]));c.close();}});
    expect(await readBoundedInboundRaw(stream,3)).toEqual(new Uint8Array([0,255,1]));
    expect(stream.locked).toBe(false);
  });

  it('cancels overflow and preserves the bound error if cancellation fails',async()=>{
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'));
    const stream = new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(2));},cancel});
    await expect(readBoundedInboundRaw(stream,1)).rejects.toThrow('admitted bounds');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('rejects short input and preserves source failures',async()=>{
    const short = new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(1));c.close();}});
    await expect(readBoundedInboundRaw(short,2)).rejects.toThrow('declared size');
    expect(short.locked).toBe(false);
    const failure = new Error('source failed');
    const broken = new ReadableStream<Uint8Array>({pull(c){c.error(failure);}});
    await expect(readBoundedInboundRaw(broken,1)).rejects.toBe(failure);
    expect(broken.locked).toBe(false);
  });

  it('bounds empty-chunk work independently of the byte count',async()=>{
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array());},cancel},{highWaterMark:0});
    await expect(readBoundedInboundRaw(stream,1)).rejects.toThrow('admitted bounds');
    expect(pulls).toBe(MAX_INBOUND_RAW_CHUNKS+1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
  it('accepts the exact byte ceiling without retaining the source buffer',async()=>{
    const payload = new Uint8Array(MAX_INBOUND_RAW_BYTES).fill(17);
    const stream = new ReadableStream<Uint8Array>({start(c){c.enqueue(payload);c.close();}});
    const result = await readBoundedInboundRaw(stream,MAX_INBOUND_RAW_BYTES);
    expect(result.byteLength).toBe(MAX_INBOUND_RAW_BYTES);
    expect(result.every(byte=>byte===17)).toBe(true);
    payload.fill(0);
    expect(result[0]).toBe(17);
    expect(stream.locked).toBe(false);
  });

  it('cancels an invalid chunk type and releases its reader',async()=>{
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({pull(c){c.enqueue(new ArrayBuffer(1) as unknown as Uint8Array);},cancel},{highWaterMark:0});
    await expect(readBoundedInboundRaw(stream,1)).rejects.toThrow('admitted bounds');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('copies a reusable producer buffer before the next pull mutates it',async()=>{
    const shared = new Uint8Array([1,2]);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({pull(c){
      if (pulls++ === 0) c.enqueue(shared);
      else { shared.set([3,4]); c.enqueue(shared); c.close(); }
    }},{highWaterMark:0});
    expect(await readBoundedInboundRaw(stream,4)).toEqual(new Uint8Array([1,2,3,4]));
    expect(pulls).toBe(2);
    expect(stream.locked).toBe(false);
  });

});
