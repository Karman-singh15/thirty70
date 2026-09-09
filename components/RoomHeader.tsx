"use client";

import { useState } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { InviteLink } from "@/components/InviteLink";
import { ParticipantsList } from "@/components/ParticipantsList";
import { MediaControls } from "@/components/MediaControls";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ParticipantDisplay } from "@/lib/editorDoc";

interface RoomHeaderProps {
  roomName: string;
  inviteCode: string;
  participants: ParticipantDisplay[];
  onlineUserIds: string[];
  micOn: string[];
  cameraOn: string[];
  maxParticipants: number;
  myMicOn: boolean;
  myCameraOn: boolean;
  mediaError: string | null;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  leavePending?: boolean;
  isHost?: boolean;
}

export function RoomHeader({
  roomName,
  inviteCode,
  participants,
  onlineUserIds,
  micOn,
  cameraOn,
  maxParticipants,
  myMicOn,
  myCameraOn,
  mediaError,
  onToggleMic,
  onToggleCamera,
  onLeave,
  leavePending = false,
  isHost = false,
}: RoomHeaderProps) {
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // Going back and pressing Leave are the same departure — you can only be in
  // one room at a time, so walking out the back door has to actually remove
  // you rather than leaving a membership behind.
  const askToLeave = () => setConfirmingLeave(true);

  const lastOneOut = participants.length <= 1;
  const description = lastOneOut
    ? "You're the only one here, so the room will be closed and the code in it discarded."
    : isHost
      ? "You'll be removed from the room, and the next person in the turn queue becomes the host."
      : "You'll be removed from the room. You can rejoin with the invite link while it's still open.";

  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={askToLeave}
          disabled={leavePending}
          aria-label="Leave room"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-60"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
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
          maxParticipants={maxParticipants}
        />
        <div className="h-6 w-px bg-zinc-800" />
        <InviteLink inviteCode={inviteCode} />
        <div className="h-6 w-px bg-zinc-800" />
        <button
          onClick={askToLeave}
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

      <ConfirmDialog
        open={confirmingLeave}
        title="Leave this room?"
        description={description}
        confirmLabel="Leave room"
        cancelLabel="Stay"
        pending={leavePending}
        onConfirm={onLeave}
        onCancel={() => setConfirmingLeave(false)}
      />
    </div>
  );
}
