"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";

interface ProblemSummary {
  title: string;
  titleSlug: string;
  difficulty: string;
  frontendQuestionId: string;
  paidOnly: boolean;
  topicTags: { name: string; slug: string }[];
}

interface ProblemSearchProps {
  // Awaited, so the row that was clicked can show it's loading until the
  // problem is actually live in the room.
  onSelect: (problem: ProblemSummary) => Promise<void> | void;
}

const difficultyColor: Record<string, string> = {
  Easy: "text-emerald-400",
  Medium: "text-amber-400",
  Hard: "text-red-400",
};

export function ProblemSearch({ onSelect }: ProblemSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // Which problem is being loaded into the room right now. This is the
  // slowest action in the app — it fetches from LeetCode and then rewrites
  // the room's session — so it gets the most explicit feedback.
  const [selectingSlug, setSelectingSlug] = useState<string | null>(null);

  async function handleSelect(problem: ProblemSummary) {
    if (selectingSlug) return;
    setSelectingSlug(problem.titleSlug);
    try {
      await onSelect(problem);
      setQuery("");
      setResults([]);
    } finally {
      setSelectingSlug(null);
    }
  }

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/leetcode/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.problems ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search LeetCode problems..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" />
        )}
      </div>

      {results.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900">
          {results.map((p) => (
            <li key={p.titleSlug}>
              <button
                onClick={() => handleSelect(p)}
                disabled={p.paidOnly || selectingSlug !== null}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-zinc-800 disabled:cursor-not-allowed ${
                  selectingSlug === p.titleSlug
                    ? "bg-emerald-500/10"
                    : "disabled:opacity-40"
                }`}
              >
                <span className="w-8 shrink-0 text-zinc-500">{p.frontendQuestionId}</span>
                <span className="flex-1 truncate text-zinc-200">{p.title}</span>
                {selectingSlug === p.titleSlug ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </span>
                ) : (
                  <span
                    className={`shrink-0 text-xs ${difficultyColor[p.difficulty] ?? "text-zinc-400"}`}
                  >
                    {p.difficulty}
                  </span>
                )}
                {p.paidOnly && (
                  <span className="shrink-0 text-xs text-zinc-500">Premium</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
