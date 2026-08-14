import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redisClient?: Redis };

// Upstash gives a `rediss://` URL; ioredis enables TLS automatically from the scheme.
export const redis =
  globalForRedis.redisClient ??
  new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 3 });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redisClient = redis;
}
