// Structured server logging.
//
// The codebase had exactly one console statement in ~9,000 lines and a dozen
// silent `catch {}` blocks. Each of those catches is individually right — the
// room sweep really should keep going when one room fails — but together they
// meant a failing Redis write, a rejected Postgres connection and a broken
// broadcast were indistinguishable from nothing happening at all. "The room
// froze" was unanswerable.
//
// Deliberately dependency-free. Vercel captures stdout/stderr per invocation
// and parses JSON lines into structured fields, so this is enough to search on
// without adding a vendor. When a real error tracker is added, `report()` is
// the single place to forward to it — every swallowed failure already routes
// through here.

type Level = "info" | "warn" | "error";

/** Anything worth searching on later. Keep it flat and small. */
export type LogContext = Record<string, string | number | boolean | null | undefined>;

function emit(level: Level, event: string, context: LogContext = {}): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...context,
  });
  // error/warn to stderr so platform log filters separate them by default.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
};

/**
 * For a `catch` that intentionally continues. Records what failed and why
 * without changing control flow — the caller still swallows the error, it just
 * stops being invisible.
 *
 * This is the seam an error tracker plugs into later: one call site to change
 * rather than a dozen catch blocks to revisit.
 */
export function report(event: string, err: unknown, context: LogContext = {}): void {
  log.error(event, {
    ...context,
    error: err instanceof Error ? err.message : String(err),
    // Only the first few frames: enough to locate it, short enough that a log
    // line stays readable.
    stack: err instanceof Error ? err.stack?.split("\n").slice(1, 4).join(" | ") : undefined,
  });
}
