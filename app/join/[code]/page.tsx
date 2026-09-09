"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Loader2, Users, TriangleAlert } from "lucide-react";

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [roomFull, setRoomFull] = useState(false);
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();

  useEffect(() => {
    params.then((p) => setInviteCode(p.code));
  }, [params]);

  useEffect(() => {
    if (!isLoaded || !inviteCode) return;

    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=/join/${inviteCode}`);
      return;
    }

    async function join() {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });

      const data = await res.json();

      if (res.ok) {
        router.replace(`/room/${data.room.id}`);
      } else {
        // 409 is specifically the room-at-capacity case (see lib/rooms.ts
        // joinRoom) — worth its own message rather than a generic error.
        setRoomFull(res.status === 409);
        setError(data.error ?? "Failed to join room");
      }
    }

    join();
  }, [isLoaded, isSignedIn, inviteCode, router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas p-4 text-muted">
      {error ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              roomFull ? "bg-warn-soft" : "bg-danger-soft"
            }`}
          >
            {roomFull ? (
              <Users className="h-6 w-6 text-warn" />
            ) : (
              <TriangleAlert className="h-6 w-6 text-danger" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-ink">
              {roomFull ? "This room is full" : "Couldn't join room"}
            </p>
            <p className="text-sm text-muted">
              {roomFull
                ? "Only 4 people are allowed in a room at a time. Ask the host to free up a spot, or start your own room."
                : error}
            </p>
          </div>
          <a
            href="/dashboard"
            className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent"
          >
            Go to dashboard
          </a>
        </div>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm">Joining room...</p>
        </>
      )}
    </div>
  );
}
