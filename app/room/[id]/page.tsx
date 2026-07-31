"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { InviteLink } from "@/components/InviteLink";
import { ProblemSearch } from "@/components/ProblemSearch";
import { ProblemPanel } from "@/components/ProblemPanel";
import { CodeEditor } from "@/components/CodeEditor";
import { ParticipantsList } from "@/components/ParticipantsList";

interface RoomData {
  id: string;
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
      }),
    });

    setCode(starterCode);
    await fetch(`/api/rooms/${roomId}/sync`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: starterCode, language }),
    });

    fetchRoom();
  }

  function handleCodeChange(newCode: string) {
    isLocalEdit.current = true;
    setCode(newCode);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await fetch(`/api/rooms/${roomId}/sync`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode, language }),
      });
      lastUpdatedAt.current = Date.now();
      isLocalEdit.current = false;
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

  if (!room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading room...
      </div>
    );
  }

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

      <div className="flex flex-1 overflow-hidden border-t border-zinc-800">
        <div className="flex w-[45%] flex-col border-r border-zinc-800">
          <div className="border-b border-zinc-800 p-3">
            <ProblemSearch onSelect={handleProblemSelect} />
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
          />
        </div>
      </div>
    </div>
  );
}
