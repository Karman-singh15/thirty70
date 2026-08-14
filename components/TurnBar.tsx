"use client";

import { useEffect, useState } from "react";

interface TurnParticipant {
  userId: string;
  name: string;
  imageUrl: string;
}

interface TurnBarProps {
  participants: TurnParticipant[];
  currentTurnUserId: string | null;
  turnNumber: number;
  turnEndsAt: number | null;
  turnDurationSeconds: number;
  myUserId: string | null;
  isOwner: boolean;
  hasProblem: boolean;
  onPass: () => void;
  onChangeDuration: (seconds: number) => void;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TurnBar({
  participants,
  currentTurnUserId,
  turnNumber,
  turnEndsAt,
  turnDurationSeconds,
  myUserId,
  isOwner,
  hasProblem,
  onPass,
  onChangeDuration,
}: TurnBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [durationInput, setDurationInput] = useState(String(turnDurationSeconds));
  const [syncedDuration, setSyncedDuration] = useState(turnDurationSeconds);

  useEffect(() => {
    if (turnEndsAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [turnEndsAt]);

  // Adjust local input state during render when the server value changes,
  // without clobbering it on every render otherwise (React's recommended
  // pattern for resetting state derived from a prop).
  if (turnDurationSeconds !== syncedDuration) {
    setSyncedDuration(turnDurationSeconds);
    setDurationInput(String(turnDurationSeconds));
  }

  if (!hasProblem) {
    return (
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-4 py-2 text-xs text-zinc-500">
        {isOwner
          ? "Pick a problem below to start the first turn."
          : "Waiting for the host to pick a problem."}
      </div>
    );
  }

  const currentPlayer = participants.find((p) => p.userId === currentTurnUserId);
  const isMyTurn = currentTurnUserId !== null && currentTurnUserId === myUserId;
  const remainingMs = turnEndsAt !== null ? turnEndsAt - now : null;
  const low = remainingMs !== null && remainingMs < 15_000;

  function submitDuration(e: React.FormEvent) {
    e.preventDefault();
    const seconds = Number(durationInput);
    if (Number.isFinite(seconds) && seconds > 0) {
      onChangeDuration(seconds);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-500">Turn {turnNumber}</span>
        <span className="font-medium text-zinc-200">
          {isMyTurn ? "Your turn" : currentPlayer ? `${currentPlayer.name}'s turn` : "Waiting..."}
        </span>
        {remainingMs !== null && (
          <span
            className={`rounded px-1.5 py-0.5 font-mono ${
              low ? "bg-red-500/20 text-red-400" : "bg-zinc-800 text-zinc-300"
            }`}
          >
            {formatRemaining(remainingMs)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {isOwner && (
          <form onSubmit={submitDuration} className="flex items-center gap-1 text-xs text-zinc-500">
            <label htmlFor="turn-duration">Turn length (s)</label>
            <input
              id="turn-duration"
              type="number"
              min={10}
              max={3600}
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              className="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-200 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
            >
              Set
            </button>
          </form>
        )}

        {isMyTurn && (
          <button
            onClick={onPass}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Pass turn
          </button>
        )}
      </div>
    </div>
  );
}
