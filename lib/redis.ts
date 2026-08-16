import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redisClient?: Redis };

// Upstash gives a `rediss://` URL; ioredis enables TLS automatically from the scheme.
export const redis =
  globalForRedis.redisClient ??
  new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 3 });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redisClient = redis;
}

// A connection in subscriber mode can't run ordinary commands, so pub/sub
// listeners get their own short-lived connection rather than borrowing the
// shared client above. `maxRetriesPerRequest: null` because a subscriber is
// long-lived and should keep reconnecting rather than erroring out.
export function createRedisSubscriber(): Redis {
  return new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
}
