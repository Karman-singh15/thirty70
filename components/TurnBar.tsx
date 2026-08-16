"use client";

import { useEffect, useState } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import { TurnQueue } from "@/components/TurnQueue";

interface TurnParticipant {
  userId: string;
  name: string;
  imageUrl: string;
}

interface TurnBarProps {
  participants: TurnParticipant[];
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
}: TurnBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [customInput, setCustomInput] = useState<string | null>(null);

  useEffect(() => {
    if (turnEndsAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [turnEndsAt]);

  if (!hasProblem) {
    return (
      <div className="flex items-center border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-500">
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
          ? "border-b-emerald-500/25 border-l-emerald-500 bg-emerald-500/[0.07]"
          : "border-b-zinc-800 border-l-transparent bg-zinc-900/40"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1.5 text-xs">
          {isMyTurn && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
          )}
          <span className={isMyTurn ? "font-semibold text-emerald-300" : "font-medium text-zinc-300"}>
            {isMyTurn ? "Your turn" : currentPlayer ? `${currentPlayer.name}'s turn` : "Waiting"}
          </span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">turn {turnNumber}</span>
        </span>

        {remainingMs !== null && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums ${
              isPaused
                ? "bg-amber-500/15 text-amber-400"
                : low
                  ? "bg-red-500/15 text-red-400"
                  : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {isPaused ? "Paused · " : ""}
            {formatRemaining(remainingMs)}
          </span>
        )}

        <div className="hidden h-4 w-px shrink-0 bg-zinc-800 md:block" />

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
            <span className="hidden shrink-0 whitespace-nowrap text-[11px] text-zinc-500 lg:inline">
              only you in the rotation
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isOwner && customInput === null && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            Turn length
            <select
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
              className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 focus:outline-none"
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
            className="flex items-center gap-1 text-xs text-zinc-500"
          >
            <input
              autoFocus
              type="number"
              min={10}
              max={3600}
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onBlur={() => setCustomInput(null)}
              className="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-200 focus:outline-none"
            />
            <span>sec</span>
          </form>
        )}

        {isOwner && currentTurnUserId !== null && (
          <button
            onClick={() => onTogglePause(!isPaused)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              isPaused
                ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {isPaused ? (
              <>
                Resume
                <Play className="h-3 w-3" />
              </>
            ) : (
              <>
                Pause
                <Pause className="h-3 w-3" />
              </>
            )}
          </button>
        )}

        {isMyTurn && (
          <button
            onClick={onPass}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-sm shadow-emerald-900/40 hover:bg-emerald-500"
          >
            Pass turn
            <SkipForward className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
