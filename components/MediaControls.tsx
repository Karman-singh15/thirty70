"use client";

import { Mic, MicOff, Video, VideoOff } from "lucide-react";

interface MediaControlsProps {
  micOn: boolean;
  cameraOn: boolean;
  error: string | null;
  onToggleMic: () => void;
  onToggleCamera: () => void;
}

export function MediaControls({
  micOn,
  cameraOn,
  error,
  onToggleMic,
  onToggleCamera,
}: MediaControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onToggleMic}
        title={micOn ? "Turn off microphone" : "Turn on microphone"}
        className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
          micOn
            ? "bg-accent-soft text-accent hover:bg-accent-soft"
            : "text-muted hover:bg-elevated hover:text-ink"
        }`}
      >
        {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>

      <button
        onClick={onToggleCamera}
        title={cameraOn ? "Turn off camera" : "Turn on camera"}
        className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
          cameraOn
            ? "bg-accent-soft text-accent hover:bg-accent-soft"
            : "text-muted hover:bg-elevated hover:text-ink"
        }`}
      >
        {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </button>

      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
