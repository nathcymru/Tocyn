import { describe, expect, it, vi } from 'vitest';
import isolatedWorker from '../isolated-index';

const invalid = { ENVIRONMENT: 'preveiw' } as any;

describe('isolated Worker entrypoint', () => {
  it('fails closed when the release environment is missing or misspelled', async () => {
    expect((await isolatedWorker.fetch(new Request('https://api.example.test/health'), invalid, {} as any)).status).toBe(503);
    expect((await isolatedWorker.fetch(new Request('https://api.example.test/health'), { ...invalid, ENVIRONMENT: undefined }, {} as any)).status).toBe(503);
  });

  it('rejects inbound mail and disables scheduled work before application handlers', async () => {
    const setReject = vi.fn();
    await isolatedWorker.email({ setReject } as any, invalid, {} as any);
    expect(setReject).toHaveBeenCalledWith('Inbound email is not enabled');
    await expect(isolatedWorker.scheduled({} as any, invalid, {} as any)).resolves.toBeUndefined();
  });
});
