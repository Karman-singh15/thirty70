"use client";

import { ChevronRight } from "lucide-react";

interface QueueParticipant {
  userId: string;
  name: string;
  imageUrl: string;
}

interface TurnQueueProps {
  turnOrder: string[];
  participants: QueueParticipant[];
  currentTurnUserId: string | null;
  myUserId: string | null;
}

// The rotation, in order, with the active player called out. Reads as a
// timeline rather than a list — you should be able to tell at a glance who's
// up now and who you're waiting behind.
export function TurnQueue({
  turnOrder,
  participants,
  currentTurnUserId,
  myUserId,
}: TurnQueueProps) {
  // turnOrder is the source of truth for sequence; participants supplies the
  // display data. Anyone in the queue who has since left is dropped.
  const queue = turnOrder
    .map((userId) => participants.find((p) => p.userId === userId))
    .filter((p): p is QueueParticipant => !!p);

  if (queue.length === 0) return null;

  const currentIndex = queue.findIndex((p) => p.userId === currentTurnUserId);

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {queue.map((p, i) => {
        const isCurrent = p.userId === currentTurnUserId;
        const isMe = p.userId === myUserId;
        // "Up next" is only meaningful once someone actually holds a turn.
        const isNext =
          currentIndex >= 0 && i === (currentIndex + 1) % queue.length && !isCurrent;

        return (
          <div key={p.userId} className="flex shrink-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-zinc-700" />}

            <div
              title={`${p.name}${isCurrent ? " — playing now" : isNext ? " — up next" : ""}`}
              className={`flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 transition-colors ${
                isCurrent
                  ? "bg-emerald-500/15 ring-1 ring-emerald-500/50"
                  : "bg-zinc-800/60"
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-medium ${
                  isCurrent ? "bg-emerald-500/25 text-emerald-100" : "bg-zinc-700 text-zinc-300"
                }`}
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  p.name.charAt(0).toUpperCase()
                )}
              </div>

              <span
                className={`whitespace-nowrap text-[11px] font-medium ${
                  isCurrent ? "text-emerald-300" : isNext ? "text-zinc-400" : "text-zinc-500"
                }`}
              >
                {isMe ? "You" : p.name.split(" ")[0]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
