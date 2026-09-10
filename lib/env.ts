// Server environment, parsed once at import.
//
// Previously these were read at the point of use with a non-null assertion —
// `process.env.DATABASE_URL!` — which tells TypeScript the value is there and
// tells the runtime nothing. A missing or empty variable surfaced as a driver
// error on the first query ("connection string required", or worse, a hang),
// several layers away from the actual cause.
//
// The pattern to copy was already in the codebase: the cron route refuses to
// run at all when CRON_SECRET isn't configured, rather than starting and
// failing oddly later. This does the same for the variables the app cannot
// function without, and names the missing one.
//
// SERVER ONLY. `NEXT_PUBLIC_*` variables are deliberately absent: the bundler
// inlines those by matching the literal text `process.env.NEXT_PUBLIC_FOO`, so
// reading them through an indirection like this would leave client bundles
// with `undefined`. Client code keeps reading them directly.
// (There's no `server-only` package installed to enforce that with an import,
// so this comment is the guard — don't import this file from a component.)

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in .env.local for development, or in the Vercel project settings for a deployment.`
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const env = Object.freeze({
  /** Neon. Must be the *pooled* connection string — see lib/db/index.ts. */
  DATABASE_URL: required("DATABASE_URL"),
  /** Upstash, as a rediss:// URL. */
  REDIS_URL: required("REDIS_URL"),

  // Billing is feature-gated rather than required: the app runs perfectly well
  // without Dodo configured, it just can't sell anything. lib/billing.ts
  // already handles a missing product id, so failing at boot would be worse
  // than the behaviour that exists.
  DODO_PAYMENTS_API_KEY: optional("DODO_PAYMENTS_API_KEY"),
  DODO_PAYMENTS_WEBHOOK_KEY: optional("DODO_PAYMENTS_WEBHOOK_KEY"),
  DODO_PAYMENTS_PRO_PRODUCT_ID: optional("DODO_PAYMENTS_PRO_PRODUCT_ID"),
  /** Anything other than the literal "live_mode" means test mode. */
  DODO_PAYMENTS_ENVIRONMENT: optional("DODO_PAYMENTS_ENVIRONMENT"),

  // Deliberately optional: app/api/cron/sweep-rooms refuses to run without it
  // and says so with a 503, which is a better failure than a deployment that
  // won't boot because a background job isn't configured yet.
  CRON_SECRET: optional("CRON_SECRET"),
});

export type ServerEnv = typeof env;
