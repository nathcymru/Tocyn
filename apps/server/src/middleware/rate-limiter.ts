import { Context, Next } from "hono";
import { Env } from "../bindings";
import * as jose from 'jose';

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

/**
 * Protects an admission boundary that runs before route authentication. Unlike
 * route limits, this guard cannot be disabled by a general development switch:
 * doing so would let untrusted traffic reserve shared owner capacity.
 */
const preAdmissionRateLimitMap = new Map<string, { count: number; reset: number }>();

async function hasSignedBearerCredential(c: Context<{ Bindings: Env; Variables: any }>): Promise<boolean> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ') || !c.env.JWT_SECRET) return false;
  try {
    await jose.jwtVerify(header.substring(7), new TextEncoder().encode(c.env.JWT_SECRET), {
      algorithms: ['HS256'], requiredClaims: ['exp', 'iat', 'sub'], audience: ['app', 'widget', 'mfa-challenge'],
    });
    return true;
  } catch { return false; }
}

export const preAdmissionRateLimiter = (limit: number, windowMs: number) => {
  return async (c: Context<{ Bindings: Env; Variables: any }>, next: Next) => {
    if (c.env.OWNER_INGRESS_ADMISSION_POLICY !== 'owner-ingress-v1' || await hasSignedBearerCredential(c)) {
      return next();
    }
    const ip = c.req.header("cf-connecting-ip") || "unknown";
    const key = `${ip}:${c.req.path}`;
    const now = c.env.localNow?.() ?? Date.now();
    const record = preAdmissionRateLimitMap.get(key);

    if (!record || now > record.reset) {
      preAdmissionRateLimitMap.set(key, { count: 1, reset: now + windowMs });
    } else {
      record.count++;
      if (record.count > limit) {
        return c.json({ error: "Too many requests, please try again later." }, 429);
      }
    }

    await next();
  };
};
