import { afterEach, describe, expect, it, vi } from "vitest";

// lib/env.ts validates at import time, so each case needs a fresh module
// registry — otherwise the first import is cached and later stubs do nothing.
async function loadEnv() {
  vi.resetModules();
  return (await import("@/lib/env")).env;
}

const REQUIRED = { DATABASE_URL: "postgres://u:p@host/db", REDIS_URL: "rediss://host:6379" };

function stub(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env — required variables", () => {
  it("exposes them when present", async () => {
    stub(REQUIRED);
    const env = await loadEnv();
    expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(env.REDIS_URL).toBe(REQUIRED.REDIS_URL);
  });

  // The whole point: fail at boot, naming the variable, instead of surfacing
  // as a driver error on the first query.
  it("throws naming the variable when one is missing", async () => {
    stub({ ...REQUIRED, DATABASE_URL: undefined });
    await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
  });

  it("treats whitespace-only as missing", async () => {
    stub({ ...REQUIRED, REDIS_URL: "   " });
    await expect(loadEnv()).rejects.toThrow(/REDIS_URL/);
  });

  it("points at where to set it", async () => {
    stub({ ...REQUIRED, REDIS_URL: undefined });
    await expect(loadEnv()).rejects.toThrow(/\.env\.local|Vercel/);
  });
});

describe("env — optional variables", () => {
  // Billing and the cron job are feature-gated. A deployment that hasn't
  // configured them must still boot.
  it("boots without any billing or cron configuration", async () => {
    stub(REQUIRED);
    const env = await loadEnv();
    expect(env.DODO_PAYMENTS_API_KEY).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it("normalises empty strings to undefined", async () => {
    stub({ ...REQUIRED, CRON_SECRET: "" });
    const env = await loadEnv();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it("passes optional values through when set", async () => {
    stub({ ...REQUIRED, CRON_SECRET: "s3cret", DODO_PAYMENTS_ENVIRONMENT: "live_mode" });
    const env = await loadEnv();
    expect(env.CRON_SECRET).toBe("s3cret");
    expect(env.DODO_PAYMENTS_ENVIRONMENT).toBe("live_mode");
  });
});

describe("env — shape", () => {
  it("is frozen, so nothing can reassign a secret at runtime", async () => {
    stub(REQUIRED);
    const env = await loadEnv();
    expect(Object.isFrozen(env)).toBe(true);
  });
});
