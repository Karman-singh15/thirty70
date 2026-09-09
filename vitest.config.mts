import { defineConfig } from "vitest/config";

// Unit tests only, for now: modules with no I/O at module scope. Anything that
// imports lib/redis.ts or lib/db opens a real connection on import, so those
// paths want integration tests against a live Redis/Postgres rather than a
// pile of mocks — see the note at the top of lib/turnRotation.ts.
//
// `.mts` so the ESM syntax below is loaded as ESM. Path aliases come from
// tsconfig natively; the vite-tsconfig-paths plugin is no longer needed.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["{lib,hooks,app,components}/**/*.test.ts?(x)"],
  },
});
