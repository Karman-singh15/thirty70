"use client";

import { useEffect, useRef, useState } from "react";

// Owns the local mic/camera: requests real browser permission, keeps the live
// streams around for the self-preview tile, and exposes the individual tracks
// so useWebRTC can push them to peers. Reports on/off state upward so the
// room can show who's unmuted even before a peer connection is established.
export function useLocalMedia(
  onMicChange: (on: boolean) => void,
  onCameraChange: (on: boolean) => void
) {
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const micOn = micStream !== null;
  const cameraOn = cameraStream !== null;
  const audioTrack = micStream?.getAudioTracks()[0] ?? null;
  const videoTrack = cameraStream?.getVideoTracks()[0] ?? null;

  // Mirrored into a ref purely so the unmount cleanup below can see the
  // *current* streams. Closing over the state directly would capture the
  // first render's values (both null) and release nothing — leaving the
  // camera light on after the user leaves the room.
  const streamsRef = useRef<{ mic: MediaStream | null; camera: MediaStream | null }>({
    mic: null,
    camera: null,
  });

  useEffect(() => {
    streamsRef.current = { mic: micStream, camera: cameraStream };
  }, [micStream, cameraStream]);

  useEffect(() => {
    return () => {
      streamsRef.current.mic?.getTracks().forEach((t) => t.stop());
      streamsRef.current.camera?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function toggleMic() {
    setError(null);
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      setMicStream(null);
      onMicChange(false);
      return;
    }

    try {
      setMicStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
      onMicChange(true);
    } catch {
      setError("Couldn't access your microphone");
    }
  }

  async function toggleCamera() {
    setError(null);
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      onCameraChange(false);
      return;
    }

    try {
      setCameraStream(await navigator.mediaDevices.getUserMedia({ video: true }));
      onCameraChange(true);
    } catch {
      setError("Couldn't access your camera");
    }
  }

  return {
    micOn,
    cameraOn,
    cameraStream,
    audioTrack,
    videoTrack,
    error,
    toggleMic,
    toggleCamera,
  };
}
