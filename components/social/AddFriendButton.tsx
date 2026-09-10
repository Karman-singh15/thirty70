"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useSocial } from "@/hooks/useSocial";
import { FriendsDialog } from "@/components/social/FriendsDialog";

// The sidebar's entry point into the friends system, sitting directly above
// the profile row. The badge is the whole reason it lives in the rail rather
// than behind /settings: an incoming request has to be visible from wherever
// you already are, and the sidebar is on every page of the app.

export function AddFriendButton({ compact = false }: { compact?: boolean }) {
  const { incoming } = useSocial();
  const [open, setOpen] = useState(false);

  const pending = incoming.length;
  const label = pending > 0
    ? `Friends, ${pending} request${pending === 1 ? "" : "s"} waiting`
    : "Add friend";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={label}
        title={compact ? label : undefined}
        className={
          compact
            ? "relative flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface hover:text-ink"
            : "relative flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft transition hover:border-line-strong hover:bg-surface"
        }
      >
        <UserPlus className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {!compact && "Add friend"}

        {pending > 0 && (
          <span
            className={
              compact
                ? // On the mobile bar there's no room for a count beside the
                  // icon, so it rides on the corner of it instead.
                  "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-on-accent"
                : "ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-on-accent"
            }
          >
            {pending}
          </span>
        )}
      </button>

      <FriendsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
