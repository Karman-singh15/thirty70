"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff } from "lucide-react";

interface VideoTileProps {
  name: string;
  imageUrl: string;
  isOnline: boolean;
  micOn: boolean;
  cameraOn: boolean;
  isSelf?: boolean;
  stream?: MediaStream | null;
}

export function VideoTile({
  name,
  imageUrl,
  isOnline,
  micOn,
  cameraOn,
  isSelf,
  stream,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream ?? null;
    }
  }, [stream]);

  // We only ever have a real stream for the local participant — remote
  // camera-on state is shown as a placeholder until signaling exists.
  const showLiveVideo = isSelf && cameraOn && !!stream;

  return (
    <div
      className={`relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-900 ring-1 ${
        isOnline ? "ring-zinc-800" : "ring-zinc-800/50"
      }`}
    >
      {showLiveVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover [transform:scaleX(-1)]"
        />
      ) : cameraOn ? (
        <div className="flex flex-col items-center gap-1.5 text-zinc-500">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-sm font-medium text-zinc-200">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
              name.charAt(0).toUpperCase()
            )}
          </div>
          <span className="text-[10px]">Camera on</span>
        </div>
      ) : (
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-sm font-medium text-zinc-200">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
      )}

      {!isOnline && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
          <span className="text-[10px] font-medium text-zinc-400">Offline</span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-zinc-950/80 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-medium text-zinc-100">
          {name}
          {isSelf ? " (you)" : ""}
        </span>
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            micOn ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-500"
          }`}
        >
          {micOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
        </span>
      </div>
    </div>
  );
}
