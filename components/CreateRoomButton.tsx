"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { RoomBootLoader, type BootStep } from "@/components/RoomBootLoader";

// "creating" covers the POST; "opening" covers the navigation that follows,
// which is its own noticeable wait — the room page has to mount and open its
// stream before anything appears.
type Phase = "idle" | "creating" | "opening";

export function CreateRoomButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const router = useRouter();
  const loading = phase !== "idle";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setPhase("creating");

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "Untitled Room" }),
      });

      if (!res.ok) throw new Error("Failed to create room");

      const { room } = (await res.json()) as {
        room: { id: string; inviteCode?: string };
      };
      // The room exists from here on, so the first line can be marked done
      // with its real invite code before the navigation starts.
      setInviteCode(room.inviteCode ?? null);
      setPhase("opening");
      router.push(`/room/${room.id}`);
    } catch {
      setPhase("idle");
      setInviteCode(null);
    }
  }

  const steps: BootStep[] = [
    {
      id: "create",
      label: "creating room",
      state: phase === "creating" ? "active" : "done",
      note: inviteCode ? `· ${inviteCode}` : undefined,
    },
    {
      id: "open",
      label: "opening editor",
      state: phase === "opening" ? "active" : "pending",
    },
  ];

  if (loading) {
    return (
      <RoomBootLoader
        steps={steps}
        caption="Share the invite code once you're in — anyone with it can join the room."
      />
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent"
      >
        <Plus className="h-4 w-4" />
        New Room
      </button>
    );
  }

  return (
    <form onSubmit={handleCreate} className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Room name..."
        className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink"
      >
        Cancel
      </button>
    </form>
  );
}
