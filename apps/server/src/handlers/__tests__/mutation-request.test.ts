import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { MutationInputError, mutationInputErrorBody, readIdempotencyKey, readMutationJson } from '../mutation-request';

const app = new Hono();
app.post('/', async c => {
  try {
    return c.json({ body: await readMutationJson(c), key: readIdempotencyKey(c) });
  } catch (error) {
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
    throw error;
  }
});

describe('retry mutation request boundary', () => {
  it('accepts bounded JSON content types and a valid opaque retry key unchanged', async () => {
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Idempotency-Key': 'retry_key-01.~' },
      body: JSON.stringify({ value: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: { value: false }, key: 'retry_key-01.~' });
  });

  it.each(['retry,key', '', 'x'.repeat(129)])('rejects malformed retry key %j', async key => {
    const response = await app.request('/', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: '{}',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid Idempotency-Key', code: 'invalid_idempotency_key' });
  });

  it.each([' retry', 'retry '])('does not trim whitespace from a received retry key %j', key => {
    expect(() => readIdempotencyKey({ req: { header: () => key } } as any)).toThrow(MutationInputError);
  });

  it('returns controlled media and JSON parse failures', async () => {
    const unsupported = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toEqual({ error: 'Content-Type must be application/json', code: 'unsupported_media_type' });
    const invalid = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid JSON request body', code: 'invalid_json' });
  });
});
