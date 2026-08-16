"use client";

import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import { InviteLink } from "@/components/InviteLink";
import { ParticipantsList } from "@/components/ParticipantsList";
import { MediaControls } from "@/components/MediaControls";
import { Spinner } from "@/components/Spinner";

interface RoomHeaderProps {
  roomName: string;
  inviteCode: string;
  participants: { userId: string; name: string; imageUrl: string }[];
  onlineUserIds: string[];
  micOn: string[];
  cameraOn: string[];
  myMicOn: boolean;
  myCameraOn: boolean;
  mediaError: string | null;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  leavePending?: boolean;
}

export function RoomHeader({
  roomName,
  inviteCode,
  participants,
  onlineUserIds,
  micOn,
  cameraOn,
  myMicOn,
  myCameraOn,
  mediaError,
  onToggleMic,
  onToggleCamera,
  onLeave,
  leavePending = false,
}: RoomHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/dashboard"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="truncate text-sm font-medium text-zinc-200">{roomName}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <MediaControls
          micOn={myMicOn}
          cameraOn={myCameraOn}
          error={mediaError}
          onToggleMic={onToggleMic}
          onToggleCamera={onToggleCamera}
        />
        <div className="h-6 w-px bg-zinc-800" />
        <ParticipantsList
          participants={participants}
          onlineUserIds={onlineUserIds}
          micOn={micOn}
          cameraOn={cameraOn}
        />
        <div className="h-6 w-px bg-zinc-800" />
        <InviteLink inviteCode={inviteCode} />
        <div className="h-6 w-px bg-zinc-800" />
        <button
          onClick={onLeave}
          disabled={leavePending}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-wait disabled:opacity-60"
        >
          {leavePending ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
          {leavePending ? "Leaving…" : "Leave"}
        </button>
      </div>
    </div>
  );
}
