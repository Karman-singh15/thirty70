"use client";

import { useState } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { InviteMenu } from "@/components/InviteMenu";
import { ParticipantsList } from "@/components/ParticipantsList";
import { MediaControls } from "@/components/MediaControls";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { ParticipantDisplay } from "@/lib/editorDoc";

interface RoomHeaderProps {
  roomName: string;
  roomId: string;
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
  roomId,
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
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-3 py-2 sm:px-4 sm:py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={askToLeave}
          disabled={leavePending}
          aria-label="Leave room"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-elevated hover:text-ink disabled:opacity-60"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="truncate text-sm font-medium text-ink">{roomName}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <MediaControls
          micOn={myMicOn}
          cameraOn={myCameraOn}
          error={mediaError}
          onToggleMic={onToggleMic}
          onToggleCamera={onToggleCamera}
        />
        {/* Hidden on a phone: the same roster is in the participants panel
            below the editor, and six controls plus dividers don't fit. */}
        <div className="hidden h-6 w-px bg-line sm:block" />
        <div className="hidden sm:block">
          <ParticipantsList
            participants={participants}
            onlineUserIds={onlineUserIds}
            micOn={micOn}
            cameraOn={cameraOn}
            maxParticipants={maxParticipants}
          />
        </div>
        <div className="h-6 w-px bg-line" />
        {/* The editor fills this screen, so the theme control has to be
            reachable from it — it used to live only in the dashboard sidebar,
            which meant leaving the room to change how the room looks. */}
        <ThemeToggle />
        <div className="h-6 w-px bg-line" />
        <InviteMenu
          roomId={roomId}
          inviteCode={inviteCode}
          participantIds={participants.map((p) => p.userId)}
        />
        <div className="h-6 w-px bg-line" />
        <button
          onClick={askToLeave}
          disabled={leavePending}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-danger-soft hover:text-danger disabled:cursor-wait disabled:opacity-60"
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
