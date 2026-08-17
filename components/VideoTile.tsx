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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  // A peer's audio and video deliberately go to two different elements.
  //
  // The connection carries both kinds from the moment it's established, so a
  // peer with their camera off is still sending a video track — one that
  // produces no frames. A <video> bound to a stream like that never leaves
  // readyState 0 and so never starts playing, which silences the audio track
  // sitting in the same element: the mic appears dead until that peer turns
  // their camera on and frames finally start arriving. Giving audio its own
  // <audio> element decouples it from whether any picture exists.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const videoTracks = stream?.getVideoTracks() ?? [];
    el.srcObject = videoTracks.length > 0 ? new MediaStream(videoTracks) : null;
    if (videoTracks.length > 0) el.play().catch(() => {});
  }, [stream]);

  // Self is video-only on purpose — playing your own mic back is feedback.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || isSelf) return;

    const audioTracks = stream?.getAudioTracks() ?? [];
    if (audioTracks.length === 0) {
      el.srcObject = null;
      return;
    }
    el.srcObject = new MediaStream(audioTracks);

    // Autoplaying a remote peer *with sound* is what browsers gate behind a
    // user gesture, and arriving in a room by navigation doesn't always count
    // as one — so try it, and on rejection offer a button to turn sound on
    // under a real click. The picture is unaffected either way; its element
    // is permanently muted.
    el.muted = false;
    el.play()
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true));
  }, [stream, isSelf]);

  function enableAudio() {
    const el = audioRef.current;
    if (!el || !el.srcObject) return;
    el.muted = false;
    el.play()
      .then(() => setAudioBlocked(false))
      .catch(() => {});
  }

  // Autoplay-with-sound is normally refused the first time a peer's audio
  // arrives — nothing about connecting to a room counts as the user gesture
  // browsers require, so the audio element above stays paused. Rather
  // than leave it stuck until someone notices the small Unmute badge, the
  // very next click or keypress anywhere on the page — including e.g. the
  // mic/camera buttons, which is what people reach for first — retries it.
  useEffect(() => {
    if (!audioBlocked) return;
    const unlock = () => enableAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [audioBlocked]);

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
      {/* Carries the picture only, and is muted for good: a peer's sound
          lives on the <audio> element below so it doesn't depend on frames
          arriving. Mounted whenever there's a stream at all, so the element
          is already in place when the camera comes on. */}
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover ${
            isSelf ? "[transform:scaleX(-1)]" : ""
          } ${showVideo ? "" : "opacity-0"}`}
        />
      )}

      {!isSelf && stream && <audio ref={audioRef} autoPlay />}

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
