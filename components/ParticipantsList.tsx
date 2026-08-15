"use client";

import { Mic } from "lucide-react";

interface Participant {
  userId: string;
  name: string;
  imageUrl: string;
}

interface ParticipantsListProps {
  participants: Participant[];
  onlineUserIds: string[];
  micOn: string[];
  cameraOn: string[];
}

export function ParticipantsList({
  participants,
  onlineUserIds,
  micOn,
  cameraOn,
}: ParticipantsListProps) {
  const onlineCount = participants.filter((p) => onlineUserIds.includes(p.userId)).length;

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center -space-x-2.5">
        {participants.map((p) => {
          const isOnline = onlineUserIds.includes(p.userId);
          const hasCameraOn = cameraOn.includes(p.userId);
          const hasMicOn = micOn.includes(p.userId);

          return (
            <div key={p.userId} className="relative" title={p.name}>
              <div
                className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-xs font-medium text-zinc-200 ring-2 ring-zinc-950 ${
                  hasCameraOn ? "outline outline-2 outline-emerald-500" : ""
                }`}
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  p.name.charAt(0).toUpperCase()
                )}
              </div>

              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-zinc-950 ${
                  isOnline ? "bg-emerald-400" : "bg-zinc-600"
                }`}
              />

              {hasMicOn && (
                <span className="absolute -bottom-0.5 -left-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-zinc-950">
                  <Mic className="h-2 w-2 text-zinc-950" strokeWidth={3} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <span className="text-xs text-zinc-500">
        {onlineCount}/{participants.length} online
      </span>
    </div>
  );
}
