import { redis } from "@/lib/redis";
import { report } from "@/lib/log";

// A fixed-window rate limiter on the Redis instance already in use.
//
// Deliberately not @upstash/ratelimit: that wants the REST client and its own
// pair of environment variables, and this app talks to Upstash over ioredis
// with a single REDIS_URL. One counter key and one Lua script is the whole
// feature, and it keeps the deployment's configuration surface unchanged.
//
// Fixed window rather than sliding: a burst can straddle a boundary and get
// up to 2x the limit for a moment, which is fine for the thing this protects
// against — a client in a loop — and costs one key instead of a sorted set
// per caller.

// INCR then EXPIRE only on the first hit, atomically. Done as two commands
// from the client, a crash between them leaves a counter with no TTL, which
// locks that caller out permanently.
const FIXED_WINDOW = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {current, redis.call('TTL', KEYS[1])}
`;

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in this window. Never negative. */
  remaining: number;
  /** Seconds until the window resets — what to put in Retry-After. */
  retryAfter: number;
}

/**
 * @param bucket  Stable identifier for the caller *and* the thing being
 *                limited, e.g. `leetcode:user_123`. Different limits must use
 *                different buckets or they share a counter.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const [countRaw, ttlRaw] = (await redis.eval(
      FIXED_WINDOW,
      1,
      `ratelimit:${bucket}`,
      windowSeconds
    )) as [number, number];

    const count = Number(countRaw);
    const ttl = Number(ttlRaw);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (err) {
    // Fail open. Redis being unavailable already breaks the room; refusing
    // every request on top of that turns a degraded app into a dead one, and
    // the limiter protects against abuse rather than enforcing correctness.
    report("ratelimit.unavailable", err, { bucket });
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}

/** The 429 every limited route should return, with the standard header. */
export function tooManyRequests(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Slow down and try again." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, retryAfter)),
      },
    }
  );
}
