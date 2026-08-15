"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  code: string;
  language: string;
  turnDurationSeconds: number;
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
  const [roomId, setRoomId] = useState<string>("");
  const [room, setRoom] = useState<RoomData | null>(null);
  const [problemDetail, setProblemDetail] = useState<ProblemDetail | null>(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const lastUpdatedAt = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLocalEdit = useRef(false);
  const [problemWidth, setProblemWidth] = useState(420);
  const [participantsWidth, setParticipantsWidth] = useState(320);
  const mainRowRef = useRef<HTMLDivElement | null>(null);
  const widthsInitialized = useRef(false);

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

  const fetchRoom = useCallback(async () => {
    if (!roomId) return;
    const res = await fetch(`/api/rooms/${roomId}`);
    if (res.ok) {
      const { room: r } = await res.json();
      setRoom((prev) => ({
        onlineUserIds: [],
        micOn: [],
        cameraOn: [],
        ...prev,
        ...r,
      }));
      if (!isLocalEdit.current) {
        setCode(r.code);
        setLanguage(r.language);
      }
    }
  }, [roomId]);

  const syncState = useCallback(async () => {
    if (!roomId) return;
    const res = await fetch(`/api/rooms/${roomId}/sync`);
    if (!res.ok) return;

    const data = await res.json();

    if (data.updatedAt > lastUpdatedAt.current && !isLocalEdit.current) {
      setCode(data.code);
      setLanguage(data.language);
      lastUpdatedAt.current = data.updatedAt;
    }

    setRoom((prev) =>
      prev
        ? {
            ...prev,
            participants: data.participants,
            problem: data.problem,
            code: data.code,
            language: data.language,
            turnDurationSeconds: data.turnDurationSeconds,
            currentTurnUserId: data.currentTurnUserId,
            turnNumber: data.turnNumber,
            turnEndsAt: data.turnEndsAt,
            turnPausedRemainingMs: data.turnPausedRemainingMs,
            onlineUserIds: data.onlineUserIds,
            micOn: data.micOn,
            cameraOn: data.cameraOn,
          }
        : prev
    );
  }, [roomId]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  useEffect(() => {
    if (!roomId) return;
    const interval = setInterval(syncState, 1500);
    return () => clearInterval(interval);
  }, [roomId, syncState]);

  useEffect(() => {
    if (!room?.problem?.titleSlug) {
      setProblemDetail(null);
      return;
    }

    setProblemLoading(true);
    fetch(`/api/leetcode/problem/${room.problem.titleSlug}`)
      .then((r) => r.json())
      .then((data) => {
        setProblemDetail(data.problem ?? null);
      })
      .finally(() => setProblemLoading(false));
  }, [room?.problem?.titleSlug]);

  async function handleProblemSelect(problem: {
    title: string;
    titleSlug: string;
    difficulty: string;
    frontendQuestionId: string;
  }) {
    if (!roomId) return;

    const res = await fetch(`/api/leetcode/problem/${problem.titleSlug}`);
    const { problem: detail } = await res.json();

    const starterCode =
      detail?.codeSnippets?.find(
        (s: { langSlug: string }) => s.langSlug === LANG_MAP[language]
      )?.code ??
      detail?.codeSnippets?.[0]?.code ??
      "";

    // Problem + starter code are set atomically so the first turn starts
    // with real code already in place, before turn-gating applies.
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
        language,
      }),
    });

    setCode(starterCode);
    fetchRoom();
  }

  function handleCodeChange(newCode: string) {
    isLocalEdit.current = true;
    setCode(newCode);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/rooms/${roomId}/sync`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode, language }),
      });
      isLocalEdit.current = false;

      if (res.ok) {
        lastUpdatedAt.current = Date.now();
      } else {
        // Rejected (e.g. turn moved on mid-edit) — pull the real state back.
        syncState();
      }
    }, 500);
  }

  function handleLanguageChange(newLang: string) {
    setLanguage(newLang);
    const snippet = problemDetail?.codeSnippets?.find(
      (s) => s.langSlug === LANG_MAP[newLang]
    );
    if (snippet) {
      handleCodeChange(snippet.code);
    }
  }

  // The turn endpoints already return the fresh room in their response —
  // apply it directly instead of following up with a whole separate /sync
  // round trip (which used to double the wait on every pass/duration/pause
  // change). Only fall back to a resync if the request itself failed.
  function applyRoomUpdate(r: Partial<RoomData>) {
    setRoom((prev) => (prev ? { ...prev, ...r } : prev));
  }

  async function handlePassTurn() {
    if (!roomId) return;
    const res = await fetch(`/api/rooms/${roomId}/turn`, { method: "POST" });
    if (res.ok) {
      const { room: r } = await res.json();
      applyRoomUpdate(r);
    } else {
      syncState();
    }
  }

  async function handleSetTurnDuration(seconds: number) {
    if (!roomId) return;
    const res = await fetch(`/api/rooms/${roomId}/turn`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnDurationSeconds: seconds }),
    });
    if (res.ok) {
      const { room: r } = await res.json();
      applyRoomUpdate(r);
    } else {
      syncState();
    }
  }

  async function handleTogglePause(paused: boolean) {
    if (!roomId) return;
    const res = await fetch(`/api/rooms/${roomId}/turn`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused }),
    });
    if (res.ok) {
      const { room: r } = await res.json();
      applyRoomUpdate(r);
    } else {
      syncState();
    }
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
    error: mediaError,
    toggleMic,
    toggleCamera,
  } = useLocalMedia(
    (on) => reportMediaChange("mic", on),
    (on) => reportMediaChange("camera", on)
  );

  if (!room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading room...
      </div>
    );
  }

  const isOwner = !!myUserId && room.ownerId === myUserId;
  // Mirrors the server: no active turn yet means anyone can edit; once a
  // turn is assigned, only its holder can.
  const readOnly = room.currentTurnUserId !== null && room.currentTurnUserId !== myUserId;

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      <Header />

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
      />

      <TurnBar
        participants={room.participants}
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
            code={code}
            language={language}
            onChange={handleCodeChange}
            onLanguageChange={handleLanguageChange}
            readOnly={readOnly}
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
          />
        </div>
      </div>
    </div>
  );
}
