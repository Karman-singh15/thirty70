"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Header } from "@/components/Header";
import { RoomHeader } from "@/components/RoomHeader";
import { ProblemSearch } from "@/components/ProblemSearch";
import { ProblemPanel } from "@/components/ProblemPanel";
import { CodeEditor } from "@/components/CodeEditor";
import { TurnBar } from "@/components/TurnBar";
import { ParticipantsPanel } from "@/components/ParticipantsPanel";
import { ResizeHandle } from "@/components/ResizeHandle";
import { useLocalMedia } from "@/hooks/useLocalMedia";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSharedEditor } from "@/hooks/useSharedEditor";
import type { RoomSnapshot } from "@/lib/editorDoc";
import { usePendingActions } from "@/hooks/usePendingActions";
import { TopProgressBar } from "@/components/TopProgressBar";

const MIN_PROBLEM_WIDTH = 280;
const MAX_PROBLEM_WIDTH = 800;
const MIN_EDITOR_WIDTH = 360;
const MIN_PARTICIPANTS_WIDTH = 220;
const MAX_PARTICIPANTS_WIDTH = 520;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface RoomData {
  id: string;
  ownerId: string;
  name: string;
  inviteCode: string;
  participants: { userId: string; name: string; imageUrl: string }[];
  problem: {
    titleSlug: string;
    title: string;
    difficulty: string;
    frontendQuestionId: string;
  } | null;
  turnDurationSeconds: number;
  turnOrder: string[];
  currentTurnUserId: string | null;
  turnNumber: number;
  turnEndsAt: number | null;
  turnPausedRemainingMs: number | null;
  onlineUserIds: string[];
  micOn: string[];
  cameraOn: string[];
}

interface ProblemDetail {
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  content: string;
  difficulty: string;
  exampleTestcases: string;
  hints: string[];
  codeSnippets: { lang: string; langSlug: string; code: string }[];
}

const LANG_MAP: Record<string, string> = {
  javascript: "javascript",
  python: "python3",
  java: "java",
  cpp: "cpp",
  go: "golang",
  typescript: "typescript",
};

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId: myUserId } = useAuth();
  const router = useRouter();
  const [roomId, setRoomId] = useState<string>("");
  const [room, setRoom] = useState<RoomData | null>(null);
  const [problemDetail, setProblemDetail] = useState<ProblemDetail | null>(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const [problemWidth, setProblemWidth] = useState(420);
  const [participantsWidth, setParticipantsWidth] = useState(320);
  const mainRowRef = useRef<HTMLDivElement | null>(null);
  const widthsInitialized = useRef(false);
  const prefetchedProblem = useRef<ProblemDetail | null>(null);
  const { run, isPending, anyPending } = usePendingActions();

  // Seed the panel widths from the room's actual size on first render
  // (roughly the old 70/30, 45%-of-70% split), then leave them alone —
  // from here on out, sizing is entirely up to the user dragging the handles.
  useEffect(() => {
    if (widthsInitialized.current || !room || !mainRowRef.current) return;
    const totalWidth = mainRowRef.current.clientWidth;
    if (totalWidth > 0) {
      setProblemWidth(clamp(Math.round(totalWidth * 0.7 * 0.45), MIN_PROBLEM_WIDTH, MAX_PROBLEM_WIDTH));
      setParticipantsWidth(
        clamp(Math.round(totalWidth * 0.3), MIN_PARTICIPANTS_WIDTH, MAX_PARTICIPANTS_WIDTH)
      );
    }
    widthsInitialized.current = true;
  }, [room]);

  useEffect(() => {
    params.then((p) => setRoomId(p.id));
  }, [params]);

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

  // One-shot: seeds the fields that essentially never change after creation
  // (name, owner, invite code) and — just as importantly — is what tells us
  // via a real status code whether we belong here at all (see
  // departedFromResponse). Everything that actually changes over a room's
  // life — turn state, participants, presence, media — arrives afterward
  // over the realtime stream below, not from polling this again.
  const fetchRoom = useCallback(async () => {
    if (!roomId || departedRef.current) return;
    const res = await fetch(`/api/rooms/${roomId}`);
    if (departedFromResponse(res)) return;
    if (res.ok) {
      const { room: r } = await res.json();
      setRoom((prev) => ({
        onlineUserIds: [],
        micOn: [],
        cameraOn: [],
        turnOrder: [],
        ...prev,
        ...r,
      }));
    }
  }, [roomId, departedFromResponse]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

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

  // Fetches the problem body whenever the room's problem changes. The host
  // who picked it already has the details in hand, so they stash them (see
  // handleProblemSelect) and this skips a second trip to LeetCode.
  const problemSlug = room?.problem?.titleSlug;
  useEffect(() => {
    if (!problemSlug) {
      setProblemDetail(null);
      return;
    }
    if (prefetchedProblem.current?.titleSlug === problemSlug) {
      setProblemDetail(prefetchedProblem.current);
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

  // Mirrors the server's rule: before any turn has started anyone may write;
  // once a turn is under way, only its holder. Computed here rather than after
  // the loading return so the editor hook below can be given it.
  const currentTurnUserId = room?.currentTurnUserId ?? null;
  const canEdit = currentTurnUserId === null || currentTurnUserId === myUserId;

  // The editor's document, language and cursor, shared with everyone in the
  // room over a live event stream.
  const editor = useSharedEditor({
    roomId,
    myUserId: myUserId ?? null,
    canEdit,
    writerId: currentTurnUserId,
    onRoomEvent: handleRoomEvent,
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
        (s: { langSlug: string }) => s.langSlug === LANG_MAP[editor.language]
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
    const snippet = problemDetail?.codeSnippets?.find(
      (s) => s.langSlug === LANG_MAP[newLang]
    );
    editor.setDocument(snippet?.code ?? editor.getCode(), newLang);
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
        fetchRoom();
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
        fetchRoom();
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
        fetchRoom();
      }
    });
  }

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
  const { remoteStreams, connectionStates } = useWebRTC({
    roomId,
    myUserId: myUserId ?? null,
    peerIds: room?.onlineUserIds ?? [],
    audioTrack,
    videoTrack,
  });

  if (!room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading room...
      </div>
    );
  }

  const isOwner = !!myUserId && room.ownerId === myUserId;
  const readOnly = !canEdit;

  // Whose cursor we're showing, resolved to a name. Only the current writer
  // broadcasts one, so there is at most one at a time.
  const cursorOwner = editor.remoteCursor
    ? room.participants.find((p) => p.userId === editor.remoteCursor!.userId)
    : undefined;
  const writerLabel =
    editor.remoteCursor && cursorOwner
      ? {
          name: cursorOwner.name,
          lineNumber: editor.remoteCursor.lineNumber,
          column: editor.remoteCursor.column,
        }
      : null;

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      <Header />
      <TopProgressBar active={anyPending} />

      <RoomHeader
        roomName={room.name}
        inviteCode={room.inviteCode}
        participants={room.participants}
        onlineUserIds={room.onlineUserIds}
        micOn={room.micOn}
        cameraOn={room.cameraOn}
        myMicOn={myMicOn}
        myCameraOn={myCameraOn}
        mediaError={mediaError}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onLeave={handleLeaveRoom}
        leavePending={isPending("leave")}
      />

      <TurnBar
        participants={room.participants}
        turnOrder={room.turnOrder}
        currentTurnUserId={room.currentTurnUserId}
        turnNumber={room.turnNumber}
        turnEndsAt={room.turnEndsAt}
        turnPausedRemainingMs={room.turnPausedRemainingMs}
        turnDurationSeconds={room.turnDurationSeconds}
        myUserId={myUserId ?? null}
        isOwner={isOwner}
        hasProblem={!!room.problem}
        onPass={handlePassTurn}
        onChangeDuration={handleSetTurnDuration}
        onTogglePause={handleTogglePause}
        passPending={isPending("pass")}
        pausePending={isPending("pause")}
        durationPending={isPending("duration")}
      />

      <div ref={mainRowRef} className="flex flex-1 overflow-hidden border-t border-zinc-800">
        <div className="flex shrink-0 flex-col" style={{ width: problemWidth }}>
          <div className="border-b border-zinc-800 p-3">
            {isOwner ? (
              <ProblemSearch onSelect={handleProblemSelect} />
            ) : (
              <p className="text-xs text-zinc-500">Only the host can pick a problem.</p>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <ProblemPanel problem={problemDetail} loading={problemLoading} />
          </div>
        </div>

        <ResizeHandle
          onResize={(deltaX) =>
            setProblemWidth((w) => clamp(w + deltaX, MIN_PROBLEM_WIDTH, MAX_PROBLEM_WIDTH))
          }
        />

        <div className="flex-1 overflow-hidden" style={{ minWidth: MIN_EDITOR_WIDTH }}>
          <CodeEditor
            language={editor.language}
            onLanguageChange={handleLanguageChange}
            onEditorMount={editor.attach}
            readOnly={readOnly}
            writerLabel={writerLabel}
            connected={editor.connected}
          />
        </div>

        <ResizeHandle
          onResize={(deltaX) =>
            setParticipantsWidth((w) =>
              clamp(w - deltaX, MIN_PARTICIPANTS_WIDTH, MAX_PARTICIPANTS_WIDTH)
            )
          }
        />

        <div className="shrink-0 border-l border-zinc-800" style={{ width: participantsWidth }}>
          <ParticipantsPanel
            participants={room.participants}
            onlineUserIds={room.onlineUserIds}
            micOn={room.micOn}
            cameraOn={room.cameraOn}
            myUserId={myUserId ?? null}
            myCameraStream={myCameraStream}
            remoteStreams={remoteStreams}
            connectionStates={connectionStates}
          />
        </div>
      </div>
    </div>
  );
}
