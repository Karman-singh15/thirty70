"use client";

interface Participant {
  userId: string;
  name: string;
  imageUrl: string;
}

interface ParticipantsListProps {
  participants: Participant[];
}

export function ParticipantsList({ participants }: ParticipantsListProps) {
  return (
    <div className="flex items-center gap-1">
      {participants.map((p) => (
        <div
          key={p.userId}
          title={p.name}
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-zinc-800 bg-zinc-700 text-xs font-medium text-zinc-200"
        >
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            p.name.charAt(0).toUpperCase()
          )}
        </div>
      ))}
      <span className="ml-1 text-xs text-zinc-500">
        {participants.length} online
      </span>
    </div>
  );
}
