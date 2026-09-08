import { MiddlewareHandler } from 'hono';

/** Count actual streamed bytes; Content-Length is only an early rejection hint. */
export function requestBounds(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    if (!c.req.raw.body) return next();
    const reader = c.req.raw.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return c.json({ error: 'Payload too large' }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    c.req.raw = new Request(c.req.raw, { body: new Blob(chunks) });
    await next();
  };
}
