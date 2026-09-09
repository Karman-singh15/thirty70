"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

// Any render or data error inside a route segment lands here instead of
// blanking the page. Next remounts the segment when `reset` is called, so a
// transient failure (a dropped fetch, a bad snapshot) recovers in place
// without a full reload.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what ties this to the server log line for the same error.
    console.error(
      JSON.stringify({
        level: "error",
        event: "render.boundary",
        at: new Date().toISOString(),
        message: error.message,
        digest: error.digest ?? null,
      })
    );
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
        Something broke
      </span>
      <h1 className="max-w-sm text-2xl font-semibold tracking-tight text-ink">
        This page stopped working
      </h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        The error has been logged. Trying again usually works — the room itself
        is still running on the server.
      </p>
      {error.digest && (
        <p className="font-mono text-[11px] text-faint">ref {error.digest}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover active:scale-[0.98]"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:bg-surface"
        >
          Back to your room
        </Link>
      </div>
    </div>
  );
}
