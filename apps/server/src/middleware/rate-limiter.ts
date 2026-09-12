import { Context, Next } from "hono";
import { Env } from "../bindings";

/**
 * Simple in-memory rate limiter for Cloudflare Workers.
 * Note: This is per-isolate. For a truly distributed rate limiter,
 * use Cloudflare's rate limiting service or a Durable Object.
 */
type RateLimitRecord = { count: number; reset: number };

const RATE_LIMIT_MAP_MAX_ENTRIES = 1024;
const rateLimitMap = new Map<string, RateLimitRecord>();

const isKnownRouteIdSegment = (segment: string): boolean => {
  return /^(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f]{4,})?|[0-9A-Za-z_-]{24,})$/i.test(segment);
};

const normalizePathForUnmatchedRoute = (path: string): string => {
  if (!path || path === "/") return path;
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => (isKnownRouteIdSegment(segment) ? ":id" : segment))
    .join("/");
};

const rateLimitRouteKey = (c: Context<{ Bindings: Env; Variables: any }>): string => {
  const route = c.req.routePath || `/${normalizePathForUnmatchedRoute(c.req.path)}`;
  return `${c.req.header("cf-connecting-ip") || "unknown"}:${c.req.method}:${route}`;
};

const pruneRateLimitBuckets = (maxEntries: number, now: number): void => {
  for (const [key, record] of rateLimitMap) {
    if (now > record.reset) rateLimitMap.delete(key);
  }

  while (rateLimitMap.size > maxEntries) {
    const oldest = rateLimitMap.keys().next().value;
    if (oldest === undefined) break;
    rateLimitMap.delete(oldest);
  }
};

export const __test = {
  clearBuckets: () => rateLimitMap.clear(),
};

export const rateLimiter = (limit: number, windowMs: number, options: { maxEntries?: number } = {}) => {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? RATE_LIMIT_MAP_MAX_ENTRIES));

  return async (c: Context<{ Bindings: Env; Variables: any }>, next: Next) => {
    // Skip rate limiting if disabled via environment variable
    if (c.env?.DISABLE_RATE_LIMIT === "true") {
      return await next();
    }

    const now = Date.now();
    const key = rateLimitRouteKey(c);

    pruneRateLimitBuckets(maxEntries, now);

    const record = rateLimitMap.get(key);

    if (!record || now > record.reset) {
      rateLimitMap.set(key, { count: 1, reset: now + windowMs });
    } else {
      record.count++;
      if (record.count > limit) {
        return c.json({ error: "Too many requests, please try again later." }, 429);
      }

      rateLimitMap.delete(key);
      rateLimitMap.set(key, record);
    }

    await next();
  };
};
