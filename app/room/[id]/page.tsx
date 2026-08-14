"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { InviteLink } from "@/components/InviteLink";
import { ProblemSearch } from "@/components/ProblemSearch";
import { ProblemPanel } from "@/components/ProblemPanel";
import { CodeEditor } from "@/components/CodeEditor";
import { ParticipantsList } from "@/components/ParticipantsList";
import { TurnBar } from "@/components/TurnBar";

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

  useEffect(() => {
    params.then((p) => setRoomId(p.id));
  }, [params]);

  const fetchRoom = useCallback(async () => {
    if (!roomId) return;
    const res = await fetch(`/api/rooms/${roomId}`);
    if (res.ok) {
      const { room: r } = await res.json();
      setRoom(r);
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

  async function handlePassTurn() {
    if (!roomId) return;
    await fetch(`/api/rooms/${roomId}/turn`, { method: "POST" });
    syncState();
  }

  async function handleSetTurnDuration(seconds: number) {
    if (!roomId) return;
    await fetch(`/api/rooms/${roomId}/turn`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnDurationSeconds: seconds }),
    });
    syncState();
  }

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

      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-medium text-zinc-200">{room.name}</h1>
        </div>
        <ParticipantsList participants={room.participants} />
      </div>

      <div className="px-4 py-2">
        <InviteLink inviteCode={room.inviteCode} />
      </div>

      <TurnBar
        participants={room.participants}
        currentTurnUserId={room.currentTurnUserId}
        turnNumber={room.turnNumber}
        turnEndsAt={room.turnEndsAt}
        turnDurationSeconds={room.turnDurationSeconds}
        myUserId={myUserId ?? null}
        isOwner={isOwner}
        hasProblem={!!room.problem}
        onPass={handlePassTurn}
        onChangeDuration={handleSetTurnDuration}
      />

      <div className="flex flex-1 overflow-hidden border-t border-zinc-800">
        <div className="flex w-[45%] flex-col border-r border-zinc-800">
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

        <div className="flex-1">
          <CodeEditor
            code={code}
            language={language}
            onChange={handleCodeChange}
            onLanguageChange={handleLanguageChange}
            readOnly={readOnly}
          />
        </div>
      </div>
    </div>
  );
}
