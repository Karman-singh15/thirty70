"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Link2, UserPlus, Users } from "lucide-react";
import { useSocial } from "@/hooks/useSocial";
import { UserAvatar } from "@/components/social/UserAvatar";
import { Spinner } from "@/components/Spinner";

// The room's Invite control: a dropdown over the two ways to get someone in
// here. Replaced the bare copy-link button once friends existed — a link is
// still the only way to reach someone who isn't on your list, so it stays as
// the first option rather than being displaced by the friends flow.

interface InviteMenuProps {
  roomId: string;
  inviteCode: string;
  /** Already in the room — offering to invite them again would be a dead button. */
  participantIds: string[];
}

type View = "menu" | "friends";

export function InviteMenu({ roomId, inviteCode, participantIds }: InviteMenuProps) {
  const { friends, sentInvites, markInviteSent } = useSocial();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [copied, setCopied] = useState(false);
  // Per-friend, so two invites can be in flight without either button
  // borrowing the other's state.
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setView("menu");
    setError(null);
  }, []);

  // Click-outside and Escape. Both, because this sits in a header where the
  // next click is usually on something else in that header — and a dropdown
  // that needs a second click on the trigger to dismiss feels stuck.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  async function copyLink() {
    const inviteUrl = `${window.location.origin}/join/${inviteCode}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      close();
    } catch {
      // Clipboard access can be refused (an insecure origin, a permission
      // policy). Saying so beats a button that silently does nothing.
      setError("Couldn't copy — copy it from the address bar instead.");
    }
  }

  async function invite(userId: string) {
    setSending((prev) => ({ ...prev, [userId]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/rooms/${roomId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't send that invite.");
        return;
      }

      // Held in the provider, not here, so the stream can take it back down.
      // It stays "Sent" while the invite is genuinely outstanding — not on a
      // timer, and no longer forever: answering it re-arms this button (see
      // the invite_resolved event), which is what lets you ask again after
      // someone declines.
      markInviteSent(roomId, userId);
    } catch {
      setError("Couldn't send that invite.");
    } finally {
      setSending((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  }

  // Whoever isn't already sitting here. Online first — that ordering comes
  // from the server (see getSocialGraph), so it's the same everywhere.
  const invitable = friends.filter((f) => !participantIds.includes(f.userId));
  const onlineCount = invitable.filter((f) => f.online).length;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted transition-colors hover:bg-elevated hover:text-ink"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-accent" />
            <span className="text-accent">Copied</span>
          </>
        ) : (
          <>
            <UserPlus className="h-3.5 w-3.5" />
            Invite
            <ChevronDown
              className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/40"
        >
          {error && (
            <p
              role="alert"
              className="border-b border-danger-line bg-danger-soft px-3 py-2 text-[11px] text-danger"
            >
              {error}
            </p>
          )}

          {view === "menu" ? (
            <div className="p-1">
              <button
                role="menuitem"
                onClick={copyLink}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs text-ink-soft transition hover:bg-elevated hover:text-ink"
              >
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="flex-1">Copy link</span>
              </button>

              <button
                role="menuitem"
                onClick={() => setView("friends")}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs text-ink-soft transition hover:bg-elevated hover:text-ink"
              >
                <Users className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="flex-1">Add a friend</span>
                {onlineCount > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    {onlineCount}
                  </span>
                )}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <button
                  onClick={() => setView("menu")}
                  className="text-[11px] text-muted transition hover:text-ink"
                >
                  ← Back
                </button>
                <span className="ml-auto text-[11px] text-faint">
                  {onlineCount} online
                </span>
              </div>

              {invitable.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-muted">
                  {friends.length === 0
                    ? "No friends yet. Add someone from the dashboard, then invite them here."
                    : "Everyone on your list is already in this room."}
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto p-1">
                  {invitable.map((friend) => (
                    <li key={friend.userId}>
                      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-elevated">
                        <UserAvatar
                          src={friend.imageUrl}
                          name={friend.name}
                          className="h-7 w-7"
                          online={friend.online}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-ink">{friend.name}</p>
                          <p className="truncate text-[10px] text-muted">
                            @{friend.username}
                          </p>
                        </div>

                        {sentInvites.has(`${roomId}:${friend.userId}`) ? (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] text-success">
                            <Check className="h-3 w-3" />
                            Sent
                          </span>
                        ) : (
                          <button
                            onClick={() => invite(friend.userId)}
                            disabled={sending[friend.userId]}
                            className="shrink-0 rounded-md border border-line px-2 py-1 text-[10px] font-medium text-ink-soft transition hover:border-line-strong hover:bg-surface disabled:opacity-60"
                          >
                            {sending[friend.userId] ? (
                              <Spinner className="h-3 w-3" />
                            ) : (
                              "Invite"
                            )}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
