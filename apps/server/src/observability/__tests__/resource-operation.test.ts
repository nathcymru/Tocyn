import { describe, expect, it, vi } from 'vitest';
import { measureResourceOperation, resourceOperationEvent } from '../resource-operation';

describe('resource operation observability', () => {
  it('emits one allowlisted success event and returns the result', async () => {
    const emit = vi.fn(); let tick = 10;
    await expect(measureResourceOperation({ resource: 'd1', operation: 'read', execute: () => 'ok', now: () => tick++, emit })).resolves.toBe('ok');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toEqual({ version: 1, type: 'resource.operation', resource: 'd1', operation: 'read', outcome: 'success', latencyMs: 1 });
  });

  it('emits failure and preserves the original error identity', async () => {
    const emit = vi.fn(); const error = new Error('private detail');
    await expect(measureResourceOperation({ resource: 'r2', operation: 'write', execute: () => { throw error; }, emit })).rejects.toBe(error);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'r2', outcome: 'failure' }));
    expect(JSON.stringify(emit.mock.calls[0][0])).not.toContain('private detail');
  });

  it('supports disabled mode by omitting the sink', async () => {
    const execute = vi.fn().mockResolvedValue(3);
    await expect(measureResourceOperation({ resource: 'ai', operation: 'invoke', execute })).resolves.toBe(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('swallows sink and clock failures and executes exactly once', async () => {
    const execute = vi.fn().mockResolvedValue('value');
    await expect(measureResourceOperation({ resource: 'workflow', operation: 'run', execute, now: () => { throw new Error('clock'); }, emit: async () => { throw new Error('sink'); } })).resolves.toBe('value');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown classifications and invalid latency', () => {
    expect(() => resourceOperationEvent({ resource: 'd1', operation: 'arbitrary', outcome: 'success', latencyMs: 1 })).toThrow();
    expect(() => resourceOperationEvent({ resource: 'd1', operation: 'read', outcome: 'success', latencyMs: -1 })).toThrow();
  });
});

it('drops arbitrary runtime fields instead of spreading them into telemetry', () => {
  const input = {resource:'d1' as const,operation:'read',outcome:'success' as const,latencyMs:1,tenantId:'private-tenant',error:'private-error',content:'private-content'};
  const event = resourceOperationEvent(input);
  expect(Object.keys(event).sort()).toEqual(['version','type','resource','operation','outcome','latencyMs'].sort());
  expect(JSON.stringify(event)).not.toContain('private'); expect(Object.isFrozen(event)).toBe(true);
});
it('does not wait for a telemetry sink and preserves object identity', async () => {
  const result={private:'result'};const execute=vi.fn(()=>result);
  await expect(measureResourceOperation({resource:'d1',operation:'batch',execute,emit:()=>new Promise(()=>{})})).resolves.toBe(result);
  expect(execute).toHaveBeenCalledTimes(1);
});
it('discards untrustworthy clocks rather than fabricating elapsed time', async () => {
  const emit=vi.fn();let calls=0;
  await expect(measureResourceOperation({resource:'r2',operation:'read',execute:()=>1,emit,now:()=>{if(calls++===0)throw new Error('clock');return 100;}})).resolves.toBe(1);
  expect(emit).not.toHaveBeenCalled();
  const now=vi.fn(()=>{throw new Error('disabled clock');});
  await expect(measureResourceOperation({resource:'r2',operation:'read',execute:()=>1,now})).resolves.toBe(1);expect(now).not.toHaveBeenCalled();
});
it.each([false,true])('preserves an operation error when the sink fails (async=%s)', async asynchronous => {
  const original={private:'operation error'}; const execute=vi.fn(()=>{throw original;});
  const emit=()=>{if(asynchronous)return Promise.reject(new Error('sink'));throw new Error('sink');};
  await expect(measureResourceOperation({resource:'ai',operation:'embed',execute,emit})).rejects.toBe(original);
  expect(execute).toHaveBeenCalledTimes(1);
});
