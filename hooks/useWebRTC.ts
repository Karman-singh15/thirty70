"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SignalPayload } from "@/lib/editorDoc";

// Peer-to-peer audio/video between everyone in a room (full mesh — fine for
// the handful of people a practice room holds; it would need an SFU well
// before it needed anything else).
//
// Only the handshake goes through our server, via /api/rooms/[id]/signal to
// send and the room's SSE stream to receive (see receiveSignal below) — the
// media itself flows browser-to-browser once that's done.

const ICE_SERVERS: RTCIceServer[] = [
  // Google's public STUN. Enough for peers to discover their public address
  // on typical home/mobile networks. There is deliberately no TURN relay
  // here — TURN means paying to carry every packet — so strict corporate or
  // symmetric-NAT networks will fail to connect.
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const OUTBOX_FLUSH_MS = 200;

// Signaling is fire-and-forget, so an opening offer can simply go missing —
// the far side was still loading, or its event stream was mid-reconnect and
// the queued copy had already been drained by an earlier connection. Nothing
// else recovers from that: a connection that never got a reply sits at
// connectionState "new" forever, never reaching "failed", so the teardown
// below never fires and the reconciliation effect has no reason to re-run.
// The watchdog re-sends the opening signal until the handshake takes.
const HANDSHAKE_RETRY_MS = 4000;
// Bounded so a genuinely unreachable peer (no TURN on a locked-down network)
// stops generating signaling traffic instead of retrying for the whole session.
const MAX_HANDSHAKE_ATTEMPTS = 5;

interface OutboundSignal {
  to: string;
  session: string;
  kind: SignalPayload["kind"];
  data: unknown;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  // Keyed by kind so a re-negotiated track of the same kind replaces the old
  // one instead of piling up.
  tracks: Map<string, MediaStreamTrack>;
  pendingCandidates: RTCIceCandidateInit[];
  // Which page load on the other end this connection belongs to. A signal
  // bearing a different session means they reloaded and this one is dead.
  remoteSession: string | null;
}

interface UseWebRTCOptions {
  roomId: string;
  myUserId: string | null;
  peerIds: string[];
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
}

export function useWebRTC({
  roomId,
  myUserId,
  peerIds,
  audioTrack,
  videoTrack,
}: UseWebRTCOptions) {
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  // Surfaced to the UI so a peer that never connects (no TURN, blocked
  // network) shows why instead of just sitting on a blank tile.
  const [connectionStates, setConnectionStates] = useState<
    Record<string, RTCPeerConnectionState>
  >({});
  const peersRef = useRef(new Map<string, PeerEntry>());
  // Counted per peer rather than per connection, so tearing a peer down and
  // rebuilding it doesn't reset the budget and loop forever. Cleared when the
  // peer connects, or when they leave the room.
  const handshakeAttemptsRef = useRef(new Map<string, number>());
  const outboxRef = useRef<OutboundSignal[]>([]);
  // Regenerated on every page load, so a refresh is distinguishable from the
  // same browser simply still being here. Generated lazily on first send
  // rather than during render, since randomness during render is impure.
  const sessionIdRef = useRef<string | null>(null);
  const getSessionId = useCallback(() => {
    if (sessionIdRef.current === null) {
      // randomUUID needs a secure context; a plain-http LAN address (testing
      // across two devices) is not one, so keep a fallback.
      sessionIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return sessionIdRef.current;
  }, []);
  const tracksRef = useRef<{ audio: MediaStreamTrack | null; video: MediaStreamTrack | null }>({
    audio: null,
    video: null,
  });
  const identityRef = useRef<{ roomId: string; myUserId: string | null }>({
    roomId,
    myUserId,
  });

  // Debugging handle: lets you inspect live peer connections and their
  // transceivers from the console (`__rtcPeers`), which is otherwise
  // unreachable from outside the hook. In an effect rather than in render
  // because reading a ref during render is not allowed.
  useEffect(() => {
    (window as unknown as { __rtcPeers?: unknown }).__rtcPeers = peersRef.current;
  }, []);

  // Declared before the effects that read these refs, so within a single
  // commit they're already current by the time those effects run.
  useEffect(() => {
    identityRef.current = { roomId, myUserId };
  }, [roomId, myUserId]);

  useEffect(() => {
    tracksRef.current = { audio: audioTrack, video: videoTrack };
  }, [audioTrack, videoTrack]);

  const send = useCallback(
    (signal: Omit<OutboundSignal, "session">) => {
      outboxRef.current.push({ ...signal, session: getSessionId() });
    },
    [getSessionId]
  );

  // Attaches whatever local tracks currently exist to this connection, and —
  // critically — forces each transceiver to sendrecv.
  //
  // On the answering side the transceivers are created by the incoming offer,
  // and they default to recvonly. Left alone, the answer advertises "I will
  // only receive": replaceTrack() then succeeds locally while no media ever
  // leaves, and the offerer's ontrack never fires. Setting the direction
  // before createAnswer() is what makes the connection bidirectional.
  const applyTracks = useCallback((pc: RTCPeerConnection) => {
    const { audio, video } = tracksRef.current;

    for (const [kind, track] of [
      ["audio", audio],
      ["video", video],
    ] as const) {
      const transceiver = pc
        .getTransceivers()
        .find((t) => t.receiver.track?.kind === kind);
      if (!transceiver || transceiver.currentDirection === "stopped") continue;

      if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
      transceiver.sender.replaceTrack(track).catch(() => {});
    }
  }, []);

  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    peersRef.current.delete(peerId);
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setConnectionStates((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // `initiate` is decided by userId ordering so exactly one side of every pair
  // sends the offer — otherwise both offer at once and the handshake collides.
  // `announce` sends a hello so the far side learns this page load exists and
  // can discard any connection it still holds from a previous one. It is only
  // set when we discover a peer through presence — never when we're building a
  // connection in reply to their signal, which would ping-pong forever.
  const createPeer = useCallback(
    (
      peerId: string,
      initiate: boolean,
      { announce = false, remoteSession = null }: { announce?: boolean; remoteSession?: string | null } = {}
    ): PeerEntry => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // Only the offering side declares the m-lines. The answerer must NOT
      // pre-create its own: they wouldn't be associated with the offer's
      // m-lines, the browser would build a second, recvonly pair to answer
      // with, and this side would silently never send. It adopts the
      // offer's transceivers in handleSignal instead.
      //
      // Declaring both kinds up front (even with no track yet) is what makes
      // turning a camera on later a plain replaceTrack() with no second
      // offer/answer round trip through the signaling channel.
      if (initiate) {
        pc.addTransceiver("audio", { direction: "sendrecv" });
        pc.addTransceiver("video", { direction: "sendrecv" });
      }

      const entry: PeerEntry = {
        pc,
        tracks: new Map(),
        pendingCandidates: [],
        remoteSession,
      };
      peersRef.current.set(peerId, entry);

      if (announce) send({ to: peerId, kind: "hello", data: {} });

      applyTracks(pc);

      pc.onicecandidate = (e) => {
        if (e.candidate) send({ to: peerId, kind: "ice", data: e.candidate.toJSON() });
      };

      pc.ontrack = (e) => {
        entry.tracks.set(e.track.kind, e.track);
        // A brand-new MediaStream each time, rather than mutating one in
        // place. Audio and video arrive as two separate ontrack events, and a
        // <video> element does not reliably start rendering a track added to
        // the stream it is already bound to — the identity has to change so
        // the consumer re-assigns srcObject and picks up both tracks.
        const stream = new MediaStream(Array.from(entry.tracks.values()));
        setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
      };

      pc.onconnectionstatechange = () => {
        setConnectionStates((prev) => ({ ...prev, [peerId]: pc.connectionState }));
        if (pc.connectionState === "connected") {
          handshakeAttemptsRef.current.delete(peerId);
        }
        if (pc.connectionState === "failed") {
          // Tear it down and leave the entry missing. The watchdog below is
          // what notices a peer that's present but has no connection and
          // rebuilds it, re-running the handshake from scratch.
          closePeer(peerId);
        }
      };

      if (initiate) {
        (async () => {
          try {
            await pc.setLocalDescription(await pc.createOffer());
            if (pc.localDescription) {
              send({ to: peerId, kind: "offer", data: pc.localDescription.toJSON() });
            }
          } catch {
            // Connection died mid-negotiation; failed-state handler cleans up.
          }
        })();
      }

      return entry;
    },
    [applyTracks, closePeer, send]
  );

  const handleSignal = useCallback(
    async (signal: SignalPayload) => {
      const { myUserId: me } = identityRef.current;
      if (!me) return;

      let entry = peersRef.current.get(signal.from);

      // They reloaded: whatever connection we hold points at a browser that no
      // longer exists. Drop it and rebuild against the new page load.
      if (entry && entry.remoteSession && entry.remoteSession !== signal.session) {
        closePeer(signal.from);
        entry = undefined;
      }

      if (!entry) {
        // Build on demand — for a hello, or for an offer from someone we
        // haven't seen in presence yet (the sender won't spontaneously retry).
        if (signal.kind !== "hello" && signal.kind !== "offer") return;
        // Whoever holds the lower id offers, so the two sides can't both
        // initiate. Replying to an offer always means we answer.
        const initiate = signal.kind === "hello" && me < signal.from;
        entry = createPeer(signal.from, initiate, { remoteSession: signal.session });
      } else if (!entry.remoteSession) {
        entry.remoteSession = signal.session;
      }

      const { pc } = entry;

      // A hello carries no SDP — it exists purely to establish/refresh the
      // pairing, which the branch above has now done. The one exception is a
      // repeat hello from someone we've already offered to and heard nothing
      // back from: that's their watchdog telling us the offer never landed,
      // so replay it instead of both sides waiting on each other.
      if (signal.kind === "hello") {
        if (
          pc.signalingState === "have-local-offer" &&
          pc.localDescription &&
          !pc.remoteDescription
        ) {
          send({ to: signal.from, kind: "offer", data: pc.localDescription.toJSON() });
        }
        return;
      }

      try {
        if (signal.kind === "offer") {
          await pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
          // Must happen between setRemoteDescription and createAnswer: this is
          // the only moment where flipping the freshly-created transceivers to
          // sendrecv still makes it into the answer we're about to send.
          applyTracks(pc);
          await pc.setLocalDescription(await pc.createAnswer());
          if (pc.localDescription) {
            send({ to: signal.from, kind: "answer", data: pc.localDescription.toJSON() });
          }
        } else if (signal.kind === "answer") {
          if (pc.signalingState !== "have-local-offer") return;
          await pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
        } else {
          const candidate = signal.data as RTCIceCandidateInit;
          // Candidates are useless until there's a remote description to
          // attach them to, and can legitimately arrive first.
          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            entry.pendingCandidates.push(candidate);
            return;
          }
        }

        if (pc.remoteDescription && entry.pendingCandidates.length > 0) {
          const queued = entry.pendingCandidates.splice(0, entry.pendingCandidates.length);
          await Promise.all(queued.map((c) => pc.addIceCandidate(c).catch(() => {})));
        }
      } catch {
        // Malformed or out-of-order signal — drop it. A genuinely broken
        // connection surfaces through connectionState instead.
      }
    },
    [applyTracks, createPeer, closePeer, send]
  );

  // Reconcile live connections against who's actually in the room.
  const peerKey = peerIds.filter((id) => id !== myUserId).sort().join(",");
  useEffect(() => {
    if (!roomId || !myUserId) return;

    const desired = new Set(peerKey ? peerKey.split(",") : []);

    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!desired.has(peerId)) closePeer(peerId);
    }
    for (const peerId of Array.from(handshakeAttemptsRef.current.keys())) {
      if (!desired.has(peerId)) handshakeAttemptsRef.current.delete(peerId);
    }

    for (const peerId of desired) {
      if (!peersRef.current.has(peerId)) {
        createPeer(peerId, myUserId < peerId, { announce: true });
      }
    }
  }, [peerKey, roomId, myUserId, createPeer, closePeer]);

  // Retries handshakes that never got a reply, and rebuilds peers that are in
  // the room but have no connection (torn down after a failure, above).
  // Anything past setRemoteDescription is left alone: from there ICE owns the
  // outcome and does its own retrying, ending at "failed" if it can't.
  useEffect(() => {
    if (!roomId || !myUserId) return;
    const desired = peerKey ? peerKey.split(",") : [];
    if (desired.length === 0) return;

    const interval = setInterval(() => {
      for (const peerId of desired) {
        const attempts = handshakeAttemptsRef.current.get(peerId) ?? 0;
        if (attempts >= MAX_HANDSHAKE_ATTEMPTS) continue;

        const entry = peersRef.current.get(peerId);
        if (!entry) {
          handshakeAttemptsRef.current.set(peerId, attempts + 1);
          createPeer(peerId, myUserId < peerId, { announce: true });
          continue;
        }

        const { pc } = entry;
        if (pc.connectionState === "connected") {
          handshakeAttemptsRef.current.delete(peerId);
          continue;
        }
        if (pc.remoteDescription) continue;

        handshakeAttemptsRef.current.set(peerId, attempts + 1);
        if (pc.signalingState === "have-local-offer" && pc.localDescription) {
          // Re-send the same offer rather than building a new one: the far
          // side simply never saw it, and replaying it is idempotent there.
          send({ to: peerId, kind: "offer", data: pc.localDescription.toJSON() });
        } else {
          // We're the answering side with nothing to answer — nudge them to
          // offer again.
          send({ to: peerId, kind: "hello", data: {} });
        }
      }
    }, HANDSHAKE_RETRY_MS);

    return () => clearInterval(interval);
  }, [peerKey, roomId, myUserId, createPeer, send]);

  // Swap tracks into the existing senders whenever the local camera/mic
  // toggles. No renegotiation needed — the transceivers already exist.
  useEffect(() => {
    for (const entry of peersRef.current.values()) {
      applyTracks(entry.pc);
    }
  }, [audioTrack, videoTrack, applyTracks]);

  // Flush queued outbound signals as one batched request.
  useEffect(() => {
    if (!roomId) return;

    const interval = setInterval(() => {
      if (outboxRef.current.length === 0) return;
      const messages = outboxRef.current.splice(0, outboxRef.current.length);
      fetch(`/api/rooms/${roomId}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      }).catch(() => {});
    }, OUTBOX_FLUSH_MS);

    return () => clearInterval(interval);
  }, [roomId]);

  // Inbound signals arrive pushed (see receiveSignal, wired to the room's SSE
  // stream by the caller) rather than polled. They're queued and drained one
  // at a time rather than handled inline, so a burst of ICE candidates
  // arriving as separate SSE messages still goes through handleSignal in
  // order instead of racing each other against the same peer connection.
  const inboxRef = useRef<SignalPayload[]>([]);
  const draining = useRef(false);

  const drainInbox = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (inboxRef.current.length > 0) {
        const next = inboxRef.current.shift();
        if (next) await handleSignal(next);
      }
    } finally {
      draining.current = false;
    }
  }, [handleSignal]);

  const receiveSignal = useCallback(
    (signal: SignalPayload) => {
      inboxRef.current.push(signal);
      void drainInbox();
    },
    [drainInbox]
  );

  // Tear every connection down on unmount (leaving the room, navigating away).
  useEffect(() => {
    const peers = peersRef.current;
    return () => {
      for (const entry of peers.values()) {
        entry.pc.onicecandidate = null;
        entry.pc.ontrack = null;
        entry.pc.onconnectionstatechange = null;
        entry.pc.close();
      }
      peers.clear();
    };
  }, []);

  return { remoteStreams, connectionStates, receiveSignal };
}
