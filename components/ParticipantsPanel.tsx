"use client";

import { VideoTile } from "@/components/VideoTile";

interface Participant {
  userId: string;
  name: string;
  imageUrl: string;
}

interface ParticipantsPanelProps {
  participants: Participant[];
  onlineUserIds: string[];
  micOn: string[];
  cameraOn: string[];
  myUserId: string | null;
  myCameraStream: MediaStream | null;
}

export function ParticipantsPanel({
  participants,
  onlineUserIds,
  micOn,
  cameraOn,
  myUserId,
  myCameraStream,
}: ParticipantsPanelProps) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {participants.map((p) => {
        const isSelf = p.userId === myUserId;
        return (
          <VideoTile
            key={p.userId}
            name={p.name}
            imageUrl={p.imageUrl}
            isOnline={onlineUserIds.includes(p.userId)}
            micOn={micOn.includes(p.userId)}
            cameraOn={cameraOn.includes(p.userId)}
            isSelf={isSelf}
            stream={isSelf ? myCameraStream : null}
          />
        );
      })}
    </div>
  );
}
