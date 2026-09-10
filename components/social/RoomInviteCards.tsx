"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailOpen, X } from "lucide-react";
import { useSocial } from "@/hooks/useSocial";
import { UserAvatar } from "@/components/social/UserAvatar";
import { Spinner } from "@/components/Spinner";

// Room invites, on the dashboard, above the room card.
//
// Placed here rather than in a notification tray because acting on one is the
// whole point: an invite is a room you're being asked to walk into, and the
// dashboard is already the page whose job is "which room am I in". Accepting
// posts the invite's code to the existing /api/rooms/join, so it goes through
// exactly the same capacity and leave-your-other-room handling as a link.

export function RoomInviteCards() {
  const { invites, dismissInvite } = useSocial();
  const router = useRouter();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invites.length === 0) return null;

  async function accept(inviteId: string, inviteCode: string) {
    setJoiningId(inviteId);
    setError(null);

    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The room filled up or closed between the invite and the click —
        // the card goes, because there's nothing left to accept.
        setError(data.error ?? "Couldn't join that room.");
        void dismissInvite(inviteId);
        return;
      }

      void dismissInvite(inviteId);
      router.push(`/room/${data.room.id}`);
    } catch {
      setError("Couldn't join that room.");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <section className="mb-6" aria-label="Room invites">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
        <MailOpen className="h-3.5 w-3.5" />
        Invites
        <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-on-accent">
          {invites.length}
        </span>
      </h2>

      {error && (
        <p
          role="alert"
          className="mb-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className="flex items-center gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3"
          >
            <UserAvatar
              src={invite.from.imageUrl}
              name={invite.from.name}
              className="h-9 w-9"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                <span className="font-medium">{invite.from.name}</span>
                <span className="text-muted"> invited you to </span>
                <span className="font-medium">{invite.roomName}</span>
              </p>
              <p className="truncate text-xs text-muted">
                @{invite.from.username}
                {invite.problemTitle && ` · ${invite.problemTitle}`}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => accept(invite.id, invite.inviteCode)}
                disabled={joiningId !== null}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
              >
                {joiningId === invite.id && <Spinner className="h-3 w-3" />}
                {joiningId === invite.id ? "Joining…" : "Join"}
              </button>
              <button
                onClick={() => dismissInvite(invite.id)}
                disabled={joiningId !== null}
                aria-label={`Dismiss invite from ${invite.from.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-elevated hover:text-ink disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
