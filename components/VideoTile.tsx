"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2 } from "lucide-react";

interface VideoTileProps {
  name: string;
  imageUrl: string;
  isOnline: boolean;
  micOn: boolean;
  cameraOn: boolean;
  isSelf?: boolean;
  stream?: MediaStream | null;
  connectionState?: RTCPeerConnectionState;
}

export function VideoTile({
  name,
  imageUrl,
  isOnline,
  micOn,
  cameraOn,
  isSelf,
  stream,
  connectionState,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    el.srcObject = stream ?? null;
    if (!stream) return;

    // The element is mounted muted so video is always allowed to autoplay.
    // Unmuting a remote peer is what browsers gate behind a user gesture, and
    // arriving in a room by navigation doesn't always count as one — so try
    // it, and on rejection fall back to muted playback (keeping the *picture*)
    // and offer a button to turn sound on under a real click.
    if (isSelf) {
      el.play().catch(() => {});
      return;
    }

    el.muted = false;
    el.play()
      .then(() => setAudioBlocked(false))
      .catch(() => {
        el.muted = true;
        setAudioBlocked(true);
        el.play().catch(() => {});
      });
  }, [stream, isSelf]);

  function enableAudio() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.play()
      .then(() => setAudioBlocked(false))
      .catch(() => {});
  }

  const showVideo = cameraOn && !!stream;

  const avatar = (
    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-sm font-medium text-zinc-200">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );

  return (
    <div
      className={`relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-900 ring-1 ${
        isOnline ? "ring-zinc-800" : "ring-zinc-800/50"
      }`}
    >
      {/* Stays mounted whenever there's a stream, even with the camera off —
          a remote tile carries that peer's audio on the same element. */}
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Always mounted muted so autoplay is never refused; the effect
          // above unmutes remote peers once it's allowed to.
          muted
          className={`absolute inset-0 h-full w-full object-cover ${
            isSelf ? "[transform:scaleX(-1)]" : ""
          } ${showVideo ? "" : "opacity-0"}`}
        />
      )}

      {!showVideo && avatar}

      {!isOnline && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
          <span className="text-[10px] font-medium text-zinc-400">Offline</span>
        </div>
      )}

      {/* A peer that never reaches "connected" is almost always the missing
          TURN relay on a restrictive network — say so rather than showing an
          indistinguishable blank tile. */}
      {!isSelf && isOnline && connectionState && connectionState !== "connected" && (
        <span
          className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            connectionState === "failed"
              ? "bg-red-500/20 text-red-300"
              : "bg-zinc-800/90 text-zinc-400"
          }`}
        >
          {connectionState === "failed" ? "Can't connect" : "Connecting…"}
        </span>
      )}

      {audioBlocked && isOnline && (
        <button
          onClick={enableAudio}
          title="Your browser blocked autoplay — click to hear this person"
          className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-1 text-[10px] font-medium text-zinc-950 hover:bg-amber-400"
        >
          <Volume2 className="h-3 w-3" />
          Unmute
        </button>
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
