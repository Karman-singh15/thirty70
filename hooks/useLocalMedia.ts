"use client";

import { useEffect, useRef, useState } from "react";

// Local-only for now: requests real browser mic/camera permission and keeps
// the live stream around so it can be rendered as a self-preview tile.
// The stream itself isn't sent to other participants yet (needs a
// signaling channel, which comes with the realtime work later) — on/off
// state is reported up via onMicChange/onCameraChange instead.
export function useLocalMedia(
  onMicChange: (on: boolean) => void,
  onCameraChange: (on: boolean) => void
) {
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const micStream = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      micStream.current?.getTracks().forEach((t) => t.stop());
      cameraStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleMic() {
    setError(null);
    if (micOn) {
      micStream.current?.getTracks().forEach((t) => t.stop());
      micStream.current = null;
      setMicOn(false);
      onMicChange(false);
      return;
    }

    try {
      micStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicOn(true);
      onMicChange(true);
    } catch {
      setError("Couldn't access your microphone");
    }
  }

  async function toggleCamera() {
    setError(null);
    if (cameraOn) {
      cameraStream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      setCameraOn(false);
      onCameraChange(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      setCameraOn(true);
      onCameraChange(true);
    } catch {
      setError("Couldn't access your camera");
    }
  }

  return { micOn, cameraOn, cameraStream, error, toggleMic, toggleCamera };
}
