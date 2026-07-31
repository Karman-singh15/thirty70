"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Code2 } from "lucide-react";
import { Header } from "@/components/Header";
import { CreateRoomButton } from "@/components/CreateRoomButton";
import { JoinRoomForm } from "@/components/JoinRoomForm";

interface RoomSummary {
  id: string;
  name: string;
  ownerName: string;
  participantCount: number;
  problem: { title: string; difficulty: string } | null;
  createdAt: number;
}

const difficultyColor: Record<string, string> = {
  Easy: "text-emerald-400",
  Medium: "text-amber-400",
  Hard: "text-red-400",
};

export default function DashboardPage() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data) => setRooms(data.rooms ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Header />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-100">Your Rooms</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Create a room, invite friends, and solve LeetCode problems together.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <CreateRoomButton />
          <div className="w-full sm:max-w-xs">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Join with invite code
            </p>
            <JoinRoomForm />
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading rooms...</p>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-zinc-800 py-16">
            <Code2 className="h-10 w-10 text-zinc-700" />
            <p className="text-sm text-zinc-500">No rooms yet. Create one to get started!</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {rooms.map((room) => (
              <Link
                key={room.id}
                href={`/room/${room.id}`}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                <div>
                  <h3 className="font-medium text-zinc-100">{room.name}</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
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
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <Users className="h-3.5 w-3.5" />
                  {room.participantCount}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
