"use client";

import { useEffect, useRef, useState } from "react";

// The full-screen wait shown while a room is being created and again while it
// is being connected to. Both moments used to be nearly invisible — a 16px
// spinner inside a button, then the words "Loading room..." on an empty page —
// which made a two-second gap read as the app having ignored the click.
//
// It's a boot log rather than a spinner because a spinner says only "wait",
// while this says what is being waited on. Every line is a real milestone the
// caller actually observes and the clock is really counting: nothing here
// invents progress it can't see. That matters more than it sounds — a fake
// four-step sequence that always takes the same time is the thing that makes
// a loader feel cheap.
//
// Per-step durations were tried and dropped. Holding them in a ref means
// reading that ref during render (react-hooks/refs), and holding them in
// state means setting state from an effect (react-hooks/set-state-in-effect);
// both are errors in this project. The total elapsed is honest and enough.

export interface BootStep {
  id: string;
  label: string;
  state: "done" | "active" | "pending";
  /** Shown dimmed after the label — an invite code, a room name. */
  note?: string;
}

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function RoomBootLoader({
  steps,
  caption,
}: {
  steps: BootStep[];
  caption?: string;
}) {
  // Stamped in the effect rather than at useRef(performance.now()): reading a
  // clock during render is impure, and on the server there is no clock at all.
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    startedAt.current = performance.now();
    const id = window.setInterval(() => {
      if (startedAt.current !== null) {
        setElapsed(performance.now() - startedAt.current);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="loader-in fixed inset-0 z-50 flex items-center justify-center bg-canvas px-6"
      role="status"
      aria-live="polite"
    >
      <div className="grain-overlay" />

      <div className="relative w-full max-w-sm">
        <div className="flex items-center gap-2 border-b border-line pb-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-on-accent">
            7
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">
            thirty70
          </span>
          <span className="ml-auto text-xs tabular-nums text-faint">
            {formatElapsed(elapsed)}
          </span>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {steps.map((step) => {
            const finished = step.state === "done";
            const active = step.state === "active";
            return (
              <li
                key={step.id}
                className={`flex items-baseline gap-2 text-xs ${
                  active ? "text-ink" : finished ? "text-muted" : "text-faint"
                }`}
              >
                <span
                  aria-hidden
                  className={active ? "text-live" : finished ? "text-success" : ""}
                >
                  {finished ? "✓" : active ? "▸" : "·"}
                </span>

                <span className="min-w-0 flex-1 truncate">
                  {step.label}
                  {step.note && (
                    <span className="ml-1.5 text-faint">{step.note}</span>
                  )}
                </span>

                {finished ? (
                  <span className="shrink-0 text-faint">ok</span>
                ) : active ? (
                  <span
                    aria-hidden
                    className="caret-blink shrink-0 text-live"
                  >
                    █
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {caption && (
          <p className="mt-5 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}
