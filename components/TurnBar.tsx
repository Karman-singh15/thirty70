"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import { TurnQueue } from "@/components/TurnQueue";
import { Spinner } from "@/components/Spinner";
import type { ParticipantDisplay } from "@/lib/editorDoc";

interface TurnBarProps {
  participants: ParticipantDisplay[];
  turnOrder: string[];
  currentTurnUserId: string | null;
  turnNumber: number;
  turnEndsAt: number | null;
  turnPausedRemainingMs: number | null;
  turnDurationSeconds: number;
  myUserId: string | null;
  isOwner: boolean;
  hasProblem: boolean;
  onPass: () => void;
  onChangeDuration: (seconds: number) => void;
  onTogglePause: (paused: boolean) => void;
  // Fired once per turn, the moment this tab's countdown reaches zero. See
  // the effect below for why the client is the one watching the clock.
  onTurnExpired: () => void;
  passPending?: boolean;
  pausePending?: boolean;
  durationPending?: boolean;
}

const DURATION_STEPS = [30, 60, 90, 120, 180, 300, 600];

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function TurnBar({
  participants,
  turnOrder,
  currentTurnUserId,
  turnNumber,
  turnEndsAt,
  turnPausedRemainingMs,
  turnDurationSeconds,
  myUserId,
  isOwner,
  hasProblem,
  onPass,
  onChangeDuration,
  onTogglePause,
  onTurnExpired,
  passPending = false,
  pausePending = false,
  durationPending = false,
}: TurnBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [customInput, setCustomInput] = useState<string | null>(null);

  useEffect(() => {
    if (turnEndsAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [turnEndsAt]);

  // Nothing on the server is watching this clock. Since polling was removed
  // the rotation only moved when some unrelated read happened to land, so a
  // turn could sit visibly at 0:00 for most of a heartbeat before anything
  // happened — the timer being the whole mechanic, that reads as broken.
  // This tab is already counting the same deadline down for display, so the
  // moment it reaches zero it says so.
  //
  // Every tab in the room does this at once and that's fine: the server
  // claims the turn number atomically, so one call rotates and the rest are
  // no-ops. Guarded per turn number so a tab whose clock is behind can't fire
  // twice for the same turn, and so the rotation that follows doesn't
  // immediately re-trigger it.
  const expiredTurnRef = useRef<number | null>(null);
  useEffect(() => {
    if (currentTurnUserId === null || turnEndsAt === null) return;
    if (turnPausedRemainingMs !== null) return;
    if (turnEndsAt - now > 0) return;
    if (expiredTurnRef.current === turnNumber) return;
    expiredTurnRef.current = turnNumber;
    onTurnExpired();
  }, [now, turnEndsAt, turnPausedRemainingMs, currentTurnUserId, turnNumber, onTurnExpired]);

  if (!hasProblem) {
    return (
      <div className="flex items-center border-b border-line bg-surface px-4 py-2 text-xs text-muted">
        {isOwner
          ? "Pick a problem below to start the first turn."
          : "Waiting for the host to pick a problem."}
      </div>
    );
  }

  const currentPlayer = participants.find((p) => p.userId === currentTurnUserId);
  const isMyTurn = currentTurnUserId !== null && currentTurnUserId === myUserId;
  const isPaused = turnPausedRemainingMs !== null;
  const remainingMs = isPaused ? turnPausedRemainingMs : turnEndsAt !== null ? turnEndsAt - now : null;
  const low = !isPaused && remainingMs !== null && remainingMs < 15_000;

  return (
    <div
      // When it's your turn the whole bar picks up a faint emerald wash and a
      // solid left edge. Hard to miss in peripheral vision, without becoming a
      // banner that shouts over the problem itself.
      className={`flex items-center justify-between gap-4 border-b border-l-2 px-4 py-2 transition-colors ${
        isMyTurn
          ? "border-b-live-line border-l-live bg-live-soft"
          : "border-b-line border-l-transparent bg-surface"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1.5 text-xs">
          {isMyTurn && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
            </span>
          )}
          <span className={isMyTurn ? "font-semibold text-live" : "font-medium text-ink-soft"}>
            {isMyTurn ? "Your turn" : currentPlayer ? `${currentPlayer.name}'s turn` : "Waiting"}
          </span>
          <span className="text-faint">·</span>
          <span className="text-muted">turn {turnNumber}</span>
        </span>

        {remainingMs !== null && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums ${
              isPaused
                ? "bg-warn-soft text-warn"
                : low
                  ? "bg-danger-soft text-danger"
                  : "bg-elevated text-muted"
            }`}
          >
            {isPaused ? "Paused · " : ""}
            {formatRemaining(remainingMs)}
          </span>
        )}

        <div className="hidden h-4 w-px shrink-0 bg-elevated md:block" />

        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <TurnQueue
            turnOrder={turnOrder}
            participants={participants}
            currentTurnUserId={currentTurnUserId}
            myUserId={myUserId}
          />
          {/* Passing with a one-person rotation cycles straight back to you,
              which otherwise reads as the pass button being broken. */}
          {turnOrder.length === 1 && (
            <span className="hidden shrink-0 whitespace-nowrap text-[11px] text-muted lg:inline">
              only you in the rotation
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isOwner && customInput === null && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Turn length
            {durationPending && <Spinner className="h-3 w-3 text-muted" />}
            <select
              disabled={durationPending}
              value={
                DURATION_STEPS.includes(turnDurationSeconds) ? turnDurationSeconds : "custom"
              }
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustomInput(String(turnDurationSeconds));
                } else {
                  onChangeDuration(Number(e.target.value));
                }
              }}
              className="rounded border border-line-strong bg-elevated px-1.5 py-0.5 text-xs text-ink-soft focus:outline-none disabled:opacity-50"
            >
              {DURATION_STEPS.map((s) => (
                <option key={s} value={s}>
                  {formatDuration(s)}
                </option>
              ))}
              <option value="custom">
                {DURATION_STEPS.includes(turnDurationSeconds)
                  ? "Custom…"
                  : `Custom (${formatDuration(turnDurationSeconds)})`}
              </option>
            </select>
          </label>
        )}

        {isOwner && customInput !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const seconds = Number(customInput);
              if (Number.isFinite(seconds) && seconds >= 10 && seconds <= 3600) {
                onChangeDuration(seconds);
              }
              setCustomInput(null);
            }}
            className="flex items-center gap-1 text-xs text-muted"
          >
            <input
              autoFocus
              type="number"
              min={10}
              max={3600}
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onBlur={() => setCustomInput(null)}
              className="w-16 rounded border border-line-strong bg-elevated px-1.5 py-0.5 text-ink focus:outline-none"
            />
            <span>sec</span>
          </form>
        )}

        {isOwner && currentTurnUserId !== null && (
          <button
            onClick={() => onTogglePause(!isPaused)}
            disabled={pausePending}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
              isPaused
                ? "bg-warn-soft text-warn hover:bg-warn-soft"
                : "bg-elevated text-ink-soft hover:bg-line-strong"
            }`}
          >
            {isPaused ? "Resume" : "Pause"}
            {pausePending ? (
              <Spinner />
            ) : isPaused ? (
              <Play className="h-3 w-3" />
            ) : (
              <Pause className="h-3 w-3" />
            )}
          </button>
        )}

        {isMyTurn && (
          <button
            onClick={onPass}
            disabled={passPending}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent-hover px-3 py-1 text-xs font-medium text-on-accent shadow-sm shadow-accent-soft hover:bg-accent disabled:cursor-wait disabled:bg-accent-hover"
          >
            {passPending ? "Passing…" : "Pass turn"}
            {passPending ? <Spinner /> : <SkipForward className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}
