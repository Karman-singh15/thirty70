"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

interface InviteLinkProps {
  inviteCode: string;
}

export function InviteLink({ inviteCode }: InviteLinkProps) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const inviteUrl = `${window.location.origin}/join/${inviteCode}`;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={copyLink}
      title={copied ? "Copied!" : "Copy invite link"}
      className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" />
          Invite
        </>
      )}
    </button>
  );
}
