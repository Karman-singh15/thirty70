"use client";

import { useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";

interface InviteLinkProps {
  inviteCode: string;
}

export function InviteLink({ inviteCode }: InviteLinkProps) {
  const [copied, setCopied] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/join/${inviteCode}`
      : `/join/${inviteCode}`;

  async function copyLink() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <Share2 className="h-4 w-4 shrink-0 text-zinc-500" />
      <span className="truncate text-xs text-zinc-400">{inviteUrl}</span>
      <button
        onClick={copyLink}
        className="ml-auto shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        title="Copy invite link"
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
