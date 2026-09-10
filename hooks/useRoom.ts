"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useLocalMedia } from "@/hooks/useLocalMedia";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSharedEditor } from "@/hooks/useSharedEditor";
import { usePendingActions } from "@/hooks/usePendingActions";
import type { JudgeBroadcast, RoomSnapshot, SignalEvent } from "@/lib/editorDoc";
import type { LeetCodeProblemDetail } from "@/lib/leetcode";
import { LEETCODE_LANG_SLUGS } from "@/lib/leetcode";
import { LeetCodeExtensionError, runOnLeetCode } from "@/lib/leetcodeBridge";

// Everything a room *is*, separated from how it looks.
//
// app/room/[id]/page.tsx was 689 lines and about 30 hooks: presence, WebRTC,
// the shared editor, turn state, judging and problem selection all coordinated
// inside a component that also laid out four panes. That made it the file
// where a mistake was most likely and hardest to see, and it could not be
// tested without rendering the whole page.
//
// Nothing here changed behaviour — the code is the same code, in the same
// order, so the hook sequence React sees is identical. What changed is that
// the page now renders and this coordinates, and the seam between them is a
// plain object.

// The room arrives in two pieces — the one-shot read below and the stream's
// snapshots — and either can land first. The defaults cover the fields the
// read doesn't carry, so a partial merge can never leave an array undefined
// for a component that maps over it.
function withRoomDefaults(prev: RoomData | null, incoming: Partial<RoomData>): RoomData {
  return {
    onlineUserIds: [],
    micOn: [],
    cameraOn: [],
    turnOrder: [],
    ...prev,
    ...incoming,
  } as RoomData;
}

// The room as this page holds it: exactly what the stream pushes, plus the
// three fields only the one-shot read carries because they never change after
// the room is created. Composed from the wire type rather than restated, so a
// field added to the snapshot can't silently go unhandled here.
type RoomData = RoomSnapshot & {
  id: string;
  name: string;
  inviteCode: string;
};


export function useRoom(params: Promise<{ id: string }>) {
  const { userId: myUserId } = useAuth();
  const router = useRouter();
  const [roomId, setRoomId] = useState<string>("");
  const [room, setRoom] = useState<RoomData | null>(null);
  const [problemDetail, setProblemDetail] = useState<LeetCodeProblemDetail | null>(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const prefetchedProblem = useRef<LeetCodeProblemDetail | null>(null);
  const { run, isPending, anyPending } = usePendingActions();
  const [judgeBroadcast, setJudgeBroadcast] = useState<JudgeBroadcast | null>(null);
  const [judgeDismissed, setJudgeDismissed] = useState(false);
  const judgeInFlightRef = useRef(false);


  useEffect(() => {
    params.then((p) => setRoomId(p.id));
  }, [params]);

  // Mirrors how Google Meet handles a closed tab: tell the server this
  // participant is gone the moment the page actually goes away, rather than
  // waiting for their presence to quietly time out. sendBeacon is what makes
  // this reliable during unload — a normal fetch can get cancelled before it
  // reaches the network once the page starts tearing down. `persisted`
  // distinguishes a real close/navigate-away from the page merely being
  // frozen into the back/forward cache, which isn't a departure.
  //
  // This is on top of, not instead of, the server's own presence-timeout
  // fallback (see getRoom in lib/rooms.ts) — a crash, a force-quit, or the
  // OS killing the tab never fires pagehide, so that fallback is still what
  // eventually cleans those cases up.
  useEffect(() => {
    if (!roomId) return;
    const handlePageHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      navigator.sendBeacon(`/api/rooms/${roomId}/leave`);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [roomId]);

  // Anyone who is no longer in this room belongs on the dashboard, not on a
  // page they can't act on. That covers more than the Leave button: leaving
  // from a second tab, being in a room that got torn down when the last
  // person left, or opening a room you were never part of.
  //
  // 403 (not a member) and 404 (no such room) are the server saying exactly
  // that. Other failures are treated as transient and left to the next poll —
  // a blip shouldn't eject anyone mid-session.
  const departedRef = useRef(false);
  const goToDashboard = useCallback(() => {
    if (departedRef.current) return;
    departedRef.current = true;
    // replace, not push: the room is behind them now, and the back button
    // shouldn't walk them into a page that will only bounce them out again.
    router.replace("/dashboard");
  }, [router]);

  const departedFromResponse = useCallback(
    (res: Response) => {
      if (res.status === 403 || res.status === 404) {
        goToDashboard();
        return true;
      }
      return false;
    },
    [goToDashboard]
  );

  // Reads the room without touching state. Splitting the read from the write
  // is what lets each caller below decide whether it still wants the answer
  // by the time it arrives, and keeps the mount effect honest about the fact
  // that it's subscribing to the server rather than setting state on render.
  //
  // This is also — just as importantly — what tells us via a real status code
  // whether we belong here at all, which it handles itself (see
  // departedFromResponse) rather than making every caller repeat it.
  const readRoom = useCallback(async (): Promise<Partial<RoomData> | undefined> => {
    if (!roomId || departedRef.current) return undefined;
    const res = await fetch(`/api/rooms/${roomId}`);
    if (departedFromResponse(res) || !res.ok) return undefined;
    const { room: r } = await res.json();
    return r as Partial<RoomData>;
  }, [roomId, departedFromResponse]);

  // One-shot: seeds the fields that essentially never change after creation
  // (name, owner, invite code). Everything that actually changes over a
  // room's life — turn state, participants, presence, media — arrives
  // afterward over the realtime stream below, not from reading this again.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await readRoom();
      if (cancelled || !r) return;
      setRoom((prev) => withRoomDefaults(prev, r));
    })();
    return () => {
      cancelled = true;
    };
  }, [readRoom]);

  // Fallback for the turn endpoints when their own response didn't arrive —
  // see applyRoomUpdate below for the normal path.
  const resyncRoom = useCallback(async () => {
    const r = await readRoom();
    if (r) setRoom((prev) => withRoomDefaults(prev, r));
  }, [readRoom]);

  // Turn state, presence and media arrive here, pushed over the same SSE
  // connection the editor uses (see the onRoomEvent wiring below) — this
  // used to be a 700ms poll; now it's an update the moment something
  // actually changes, with no polling at all in between.
  //
  // This is also now the only way a second tab of the same account learns it
  // was removed — e.g. Leave was clicked in another tab. There's no more
  // poll to hit a 403 on, but every broadcast already carries the current
  // participant list, which is a strictly better signal: push instead of
  // poll, and no ambiguity about whether a failure was transient.
  const handleRoomEvent = useCallback(
    (snapshot: RoomSnapshot) => {
      if (myUserId && !snapshot.participants.some((p) => p.userId === myUserId)) {
        goToDashboard();
        return;
      }
      setRoom((prev) => (prev ? { ...prev, ...snapshot } : prev));
    },
    [myUserId, goToDashboard]
  );

  // Run/Submit progress and results, broadcast to the whole room so everyone
  // watching a turn sees the same loader and the same result, not just
  // whoever clicked. "opening" is always the first stage of a fresh
  // run/submit, so it's the signal that clears a previous dismissal.
  const handleJudgeEvent = useCallback((judge: JudgeBroadcast) => {
    setJudgeBroadcast(judge);
    if (judge.status === "loading" && judge.stage === "opening") setJudgeDismissed(false);
  }, []);

  // Fetches the problem body whenever the room's problem changes. The host
  // who picked it already has the details in hand, so they stash them (see
  // handleProblemSelect) and this skips a second trip to LeetCode.
  const problemSlug = room?.problem?.titleSlug;
  useEffect(() => {
    if (!problemSlug) return;

    // The host already has the body in hand from picking it, so skip the trip.
    const prefetched = prefetchedProblem.current;
    if (prefetched?.titleSlug === problemSlug) {
      setProblemDetail(prefetched);
      return;
    }

    let cancelled = false;
    setProblemLoading(true);
    fetch(`/api/leetcode/problem/${problemSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setProblemDetail(data.problem ?? null);
      })
      .finally(() => {
        if (!cancelled) setProblemLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [problemSlug]);

  // Whatever detail we're holding only counts while it belongs to the room's
  // current problem. Derived rather than cleared in the effect above: a
  // no-problem room used to null it via setState, which meant one render
  // still showing the previous problem's body — and the room genuinely does
  // pass through "no problem" whenever the host switches to another one.
  const shownProblem =
    problemDetail && problemDetail.titleSlug === problemSlug ? problemDetail : null;

  // Mirrors the server's rule: before any turn has started anyone may write;
  // once a turn is under way, only its holder. Computed here rather than after
  // the loading return so the editor hook below can be given it. No problem
  // picked yet means there's nothing to write, so the editor stays locked.
  const currentTurnUserId = room?.currentTurnUserId ?? null;
  const hasProblem = !!room?.problem;
  const canEdit = hasProblem && (currentTurnUserId === null || currentTurnUserId === myUserId);

  // useWebRTC (below) needs to exist before it can receive anything, but
  // useSharedEditor (which owns the one EventSource these signals arrive on)
  // has to be declared before it for the other state it feeds. A ref breaks
  // the cycle: this callback is stable from render one, and starts actually
  // forwarding once the effect near useWebRTC below points it somewhere.
  const webrtcSignalRef = useRef<(event: SignalEvent) => void>(() => {});
  const handleSignalEvent = useCallback(
    (event: SignalEvent) => {
      if (event.to !== myUserId) return;
      webrtcSignalRef.current(event);
    },
    [myUserId]
  );

  // The editor's document, language and cursor, shared with everyone in the
  // room over a live event stream.
  const editor = useSharedEditor({
    roomId,
    myUserId: myUserId ?? null,
    canEdit,
    writerId: currentTurnUserId,
    onRoomEvent: handleRoomEvent,
    onSignal: handleSignalEvent,
    onJudgeEvent: handleJudgeEvent,
  });

  async function handleProblemSelect(problem: {
    title: string;
    titleSlug: string;
    difficulty: string;
    frontendQuestionId: string;
  }) {
    if (!roomId) return;
    return run("problem", async () => {
    const res = await fetch(`/api/leetcode/problem/${problem.titleSlug}`);
    const { problem: detail } = await res.json();
    // Hand these to the panel directly — the effect above would otherwise
    // fetch the very same thing again the moment the room updates.
    if (detail) {
      prefetchedProblem.current = detail;
      setProblemDetail(detail);
    }

    const starterCode =
      detail?.codeSnippets?.find(
        (s: { langSlug: string }) => s.langSlug === LEETCODE_LANG_SLUGS[editor.language]
      )?.code ??
      detail?.codeSnippets?.[0]?.code ??
      "";

    // Problem + starter code are set atomically so the first turn starts
    // with real code already in place, before turn-gating applies. Everyone's
    // editor — this one included — picks up the new document from the
    // editor-channel broadcast that write publishes, and the room's new
    // participants/turn state arrives the same way over the room channel —
    // no follow-up fetch needed, this client is subscribed to both already.
    await fetch(`/api/rooms/${roomId}/sync`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        problem: {
          titleSlug: problem.titleSlug,
          title: problem.title,
          difficulty: problem.difficulty,
          frontendQuestionId: problem.frontendQuestionId,
        },
        code: starterCode,
        language: editor.language,
      }),
    });
    });
  }

  // The language is part of the shared document, so switching it swaps
  // everyone over — along with that language's starter code, when the problem
  // provides one.
  function handleLanguageChange(newLang: string) {
    const snippet = shownProblem?.codeSnippets?.find(
      (s) => s.langSlug === LEETCODE_LANG_SLUGS[newLang]
    );
    editor.setDocument(snippet?.code ?? editor.getCode(), newLang);
  }

  // Runs the extension bridge locally (only this browser has the LeetCode
  // extension and session — see extension/README.md) and posts each stage,
  // then the result, to the room's judge broadcast so everyone watching sees
  // the same thing this client does, not just the one who clicked.
  async function handleJudge(mode: "run" | "submit") {
    if (!roomId || !myUserId || !shownProblem || judgeInFlightRef.current) return;
    const myName = room?.participants.find((p) => p.userId === myUserId)?.name ?? "Someone";

    const post = (judge: JudgeBroadcast) =>
      fetch(`/api/rooms/${roomId}/judge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judge }),
      }).catch(() => {});

    const langSlug = LEETCODE_LANG_SLUGS[editor.language];
    if (!langSlug) {
      await post({
        status: "error",
        mode,
        message: `No LeetCode language mapping for "${editor.language}".`,
        userId: myUserId,
        name: myName,
      });
      return;
    }

    judgeInFlightRef.current = true;
    await post({ status: "loading", mode, stage: "opening", userId: myUserId, name: myName });

    try {
      const result = await runOnLeetCode(
        mode,
        {
          slug: shownProblem.titleSlug,
          questionId: shownProblem.questionId,
          langSlug,
          code: editor.getCode(),
          dataInput: mode === "run" ? shownProblem.exampleTestcases : undefined,
        },
        (stage) => void post({ status: "loading", mode, stage, userId: myUserId, name: myName })
      );
      await post({ status: "result", mode, result, userId: myUserId, name: myName });
    } catch (err) {
      const message =
        err instanceof LeetCodeExtensionError || err instanceof Error
          ? err.message
          : "Something went wrong talking to the LeetCode extension.";
      await post({ status: "error", mode, message, userId: myUserId, name: myName });
    } finally {
      judgeInFlightRef.current = false;
    }
  }

  // The turn endpoints already return the fresh room in their response —
  // apply it directly instead of following up with a whole separate /sync
  // round trip (which used to double the wait on every pass/duration/pause
  // change). Only fall back to a resync if the request itself failed.
  function applyRoomUpdate(r: Partial<RoomData>) {
    setRoom((prev) => (prev ? { ...prev, ...r } : prev));
  }

  async function handleLeaveRoom() {
    if (!roomId) return;
    return run("leave", async () => {
    try {
      await fetch(`/api/rooms/${roomId}/leave`, { method: "POST" });
    } catch {
      // They asked to leave; stranding them here on a network blip is the
      // worse outcome. Presence lapses on its own within seconds and the
      // turn times out normally, so the room recovers without this request.
    } finally {
      goToDashboard();
    }
    });
  }

  async function handlePassTurn() {
    if (!roomId) return;
    return run("pass", async () => {
      const res = await fetch(`/api/rooms/${roomId}/turn`, { method: "POST" });
      if (res.ok) {
        const { room: r } = await res.json();
        applyRoomUpdate(r);
      } else {
        resyncRoom();
      }
    });
  }

  async function handleSetTurnDuration(seconds: number) {
    if (!roomId) return;
    return run("duration", async () => {
      const res = await fetch(`/api/rooms/${roomId}/turn`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnDurationSeconds: seconds }),
      });
      if (res.ok) {
        const { room: r } = await res.json();
        applyRoomUpdate(r);
      } else {
        resyncRoom();
      }
    });
  }

  async function handleTogglePause(paused: boolean) {
    if (!roomId) return;
    return run("pause", async () => {
      const res = await fetch(`/api/rooms/${roomId}/turn`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      if (res.ok) {
        const { room: r } = await res.json();
        applyRoomUpdate(r);
      } else {
        resyncRoom();
      }
    });
  }

  // The room learns about the rotation from the broadcast this triggers, the
  // same as it would for a pass — so there's nothing to do with the response.
  const handleTurnExpired = useCallback(() => {
    if (!roomId) return;
    fetch(`/api/rooms/${roomId}/turn/expire`, { method: "POST" }).catch(() => {});
  }, [roomId]);

  const reportMediaChange = useCallback(
    (kind: "mic" | "camera", on: boolean) => {
      if (!roomId) return;
      setRoom((prev) => {
        if (!prev || !myUserId) return prev;
        const key = kind === "mic" ? "micOn" : "cameraOn";
        const set = new Set(prev[key]);
        if (on) set.add(myUserId);
        else set.delete(myUserId);
        return { ...prev, [key]: Array.from(set) };
      });
      fetch(`/api/rooms/${roomId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [kind]: on }),
      });
    },
    [roomId, myUserId]
  );

  const {
    micOn: myMicOn,
    cameraOn: myCameraOn,
    cameraStream: myCameraStream,
    audioTrack,
    videoTrack,
    error: mediaError,
    toggleMic,
    toggleCamera,
  } = useLocalMedia(
    (on) => reportMediaChange("mic", on),
    (on) => reportMediaChange("camera", on)
  );

  // Connect to everyone currently present, regardless of whether they have
  // media on yet — the connection is established up front so toggling a
  // camera later is instant rather than starting a handshake from scratch.
  const { remoteStreams, connectionStates, receiveSignal } = useWebRTC({
    roomId,
    myUserId: myUserId ?? null,
    peerIds: room?.onlineUserIds ?? [],
    audioTrack,
    videoTrack,
  });

  useEffect(() => {
    webrtcSignalRef.current = receiveSignal;
  }, [receiveSignal]);

  return {
    room,
    myUserId,
    editor,
    shownProblem,
    problemLoading,
    canEdit,
    judgeBroadcast,
    judgeDismissed,
    setJudgeDismissed,
    myMicOn,
    myCameraOn,
    myCameraStream,
    mediaError,
    toggleMic,
    toggleCamera,
    remoteStreams,
    connectionStates,
    isPending,
    anyPending,
    handleProblemSelect,
    handleLanguageChange,
    handleJudge,
    handleLeaveRoom,
    handlePassTurn,
    handleSetTurnDuration,
    handleTogglePause,
    handleTurnExpired,
  };
}
