import { Hono } from 'hono';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { rateLimiter, __test } from '../rate-limiter';

describe('rateLimiter', () => {
  beforeEach(() => {
    __test.clearBuckets();
  });

  it('buckets dynamic endpoint IDs by route template, not raw path', async () => {
    const app = new Hono();
    app.post('/tickets/:id/messages', rateLimiter(2, 60000), c => c.text('ok'));

    const request = (id: string) =>
      app.request(`/tickets/${id}/messages`, {
        method: 'POST',
        headers: { 'cf-connecting-ip': '198.51.100.1' },
      });

    expect((await request('111')).status).toBe(200);
    expect((await request('222')).status).toBe(200);
    expect((await request('333')).status).toBe(429);
  });

  it('keeps independent buckets for related-but-different anonymous endpoints', async () => {
    const app = new Hono();
    const limiter = rateLimiter(1, 60000);
    app.post('/tickets/:id/messages', limiter, c => c.text('ok'));
    app.post('/tickets/:id/articles', limiter, c => c.text('ok'));

    expect((await app.request('/tickets/111/messages', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.2' },
    })).status).toBe(200);

    expect((await app.request('/tickets/111/messages', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.2' },
    })).status).toBe(429);

    expect((await app.request('/tickets/111/articles', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.2' },
    })).status).toBe(200);
  });

  it('evicts old buckets when the cap is exceeded and reuses evicted route buckets', async () => {
    const app = new Hono();
    const limiter = rateLimiter(1, 30000, { maxEntries: 2 });
    app.post('/bucket/a', limiter, c => c.text('ok'));
    app.post('/bucket/b', limiter, c => c.text('ok'));
    app.post('/bucket/c', limiter, c => c.text('ok'));

    expect((await app.request('/bucket/a', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.3' },
    })).status).toBe(200);

    expect((await app.request('/bucket/b', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.3' },
    })).status).toBe(200);

    expect((await app.request('/bucket/c', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.3' },
    })).status).toBe(200);

    expect((await app.request('/bucket/a', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.3' },
    })).status).toBe(200);
  });

  it('resets expired buckets after the window', async () => {
    const clock = new Date('2026-09-12T00:00:00.000Z');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(clock);

      const app = new Hono();
      app.post('/tickets/:id/messages', rateLimiter(1, 1000), c => c.text('ok'));

      expect((await app.request('/tickets/1/messages', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '198.51.100.4' },
      })).status).toBe(200);

      expect((await app.request('/tickets/1/messages', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '198.51.100.4' },
      })).status).toBe(429);

      vi.setSystemTime(new Date(clock.getTime() + 1500));

      expect((await app.request('/tickets/1/messages', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '198.51.100.4' },
      })).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
