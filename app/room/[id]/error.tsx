"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

// The room gets its own boundary because its failure mode is specific: the
// page renders state broadcast by *other* clients, so an unexpected shape in a
// snapshot takes it down mid-turn. Reconnecting is the right first move — the
// room is still live on the server and the turn clock is still running — so
// "Rejoin" is the primary action rather than a generic retry.
export default function RoomError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "render.room_boundary",
        at: new Date().toISOString(),
        message: error.message,
        digest: error.digest ?? null,
      })
    );
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
        Room disconnected
      </span>
      <h1 className="max-w-sm text-2xl font-semibold tracking-tight text-ink">
        This room stopped rendering
      </h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        You haven&apos;t left it — the room and its timer are still running on
        the server. Rejoining reconnects the stream and pulls a fresh snapshot.
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
          Rejoin the room
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:bg-surface"
        >
          Leave and go back
        </Link>
      </div>
    </div>
  );
}
