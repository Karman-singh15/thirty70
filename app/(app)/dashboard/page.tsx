"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Code2 } from "lucide-react";
import { CreateRoomButton } from "@/components/CreateRoomButton";
import { JoinRoomForm } from "@/components/JoinRoomForm";

// You are in at most one room at a time — creating or joining one walks you
// out of any other (see leaveOtherRooms in lib/rooms.ts). So this shows the
// room you're in, not a list of rooms you could be in: a grid here could only
// ever hold one card, and presenting it as a list quietly implied you could
// keep several going at once.
interface CurrentRoom {
  id: string;
  name: string;
  ownerName: string;
  participantCount: number;
  problem: { title: string; difficulty: string } | null;
}

const difficultyColor: Record<string, string> = {
  Easy: "text-success",
  Medium: "text-warn",
  Hard: "text-danger",
};

export default function DashboardPage() {
  const [room, setRoom] = useState<CurrentRoom | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/rooms");
        const data = await res.json();
        if (!cancelled) setRoom(data.room ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-9 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Your room
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Start a room, invite a friend, and pick a problem to work through
            together. You&apos;re in one room at a time — starting or joining
            another leaves the one you&apos;re in.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <CreateRoomButton />
          <div className="w-full sm:w-64">
            <JoinRoomForm />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-[68px] animate-pulse rounded-xl border border-line bg-surface" />
      ) : !room ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface">
            <Code2 className="h-5 w-5 text-faint" />
          </div>
          <p className="text-sm font-medium text-ink-soft">You&apos;re not in a room</p>
          <p className="max-w-xs text-sm text-muted">
            Start one above and share the invite link with whoever you&apos;re
            practicing with.
          </p>
        </div>
      ) : (
        <Link
          href={`/room/${room.id}`}
          className="group flex items-center justify-between rounded-xl border border-line bg-surface px-5 py-4 transition hover:border-line hover:bg-surface"
        >
          <div className="min-w-0">
            <h3 className="truncate font-medium text-ink">{room.name}</h3>
            <p className="mt-0.5 truncate text-xs text-muted">
              by {room.ownerName}
              {room.problem && (
                <>
                  {" · "}
                  <span className={difficultyColor[room.problem.difficulty] ?? ""}>
                    {room.problem.title}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-1 text-xs text-muted transition group-hover:text-ink-soft">
            <Users className="h-3.5 w-3.5" />
            {room.participantCount}
          </div>
        </Link>
      )}
    </div>
  );
}
