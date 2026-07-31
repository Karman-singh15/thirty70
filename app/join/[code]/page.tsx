"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
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
        setError(data.error ?? "Failed to join room");
      }
    }

    join();
  }, [isLoaded, isSignedIn, inviteCode, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-400">
      {error ? (
        <>
          <p className="text-red-400">{error}</p>
          <a href="/dashboard" className="text-sm text-emerald-400 hover:underline">
            Go to dashboard
          </a>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-sm">Joining room...</p>
        </>
      )}
    </div>
  );
}
