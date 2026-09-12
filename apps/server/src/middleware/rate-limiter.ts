import { Context, Next } from "hono";
import { Env } from "../bindings";

/**
 * Simple in-memory rate limiter for Cloudflare Workers.
 * Note: This is per-isolate. For a truly distributed rate limiter,
 * use Cloudflare's rate limiting service or a Durable Object.
 */
const rateLimitMap = new Map<string, { count: number; reset: number }>();

export const rateLimiter = (limit: number, windowMs: number) => {
  return async (c: Context<{ Bindings: Env; Variables: any }>, next: Next) => {
    // Skip rate limiting if disabled via environment variable
    if (c.env.DISABLE_RATE_LIMIT === "true") {
      return await next();
    }

    // This bucket is deliberately isolate-wide. A client-provided source or
    // route key would let an attacker fan out invalid requests and keep
    // consuming the shared owner reservation behind this guard.
    const key = 'owner-ingress-unverified';
    const now = Date.now();

    const record = rateLimitMap.get(key);

    if (!record || now > record.reset) {
      rateLimitMap.set(key, { count: 1, reset: now + windowMs });
    } else {
      record.count++;
      if (record.count > limit) {
        return c.json({ error: "Too many requests, please try again later." }, 429);
      }
    }

    await next();
  };
};
