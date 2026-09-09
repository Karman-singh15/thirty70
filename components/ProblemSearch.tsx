"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";
import type { LeetCodeProblemSummary } from "@/lib/leetcode";

interface ProblemSearchProps {
  // Awaited, so the row that was clicked can show it's loading until the
  // problem is actually live in the room.
  onSelect: (problem: LeetCodeProblemSummary) => Promise<void> | void;
}

const difficultyColor: Record<string, string> = {
  Easy: "text-success",
  Medium: "text-warn",
  Hard: "text-danger",
};

export function ProblemSearch({ onSelect }: ProblemSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeetCodeProblemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // Which problem is being loaded into the room right now. This is the
  // slowest action in the app — it fetches from LeetCode and then rewrites
  // the room's session — so it gets the most explicit feedback.
  const [selectingSlug, setSelectingSlug] = useState<string | null>(null);

  async function handleSelect(problem: LeetCodeProblemSummary) {
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
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search LeetCode problems..."
          className="w-full rounded-lg border border-line-strong bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
        )}
      </div>

      {results.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-line bg-surface">
          {results.map((p) => (
            <li key={p.titleSlug}>
              <button
                onClick={() => handleSelect(p)}
                disabled={p.paidOnly || selectingSlug !== null}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-elevated disabled:cursor-not-allowed ${
                  selectingSlug === p.titleSlug
                    ? "bg-accent-soft"
                    : "disabled:opacity-40"
                }`}
              >
                <span className="w-8 shrink-0 text-muted">{p.frontendQuestionId}</span>
                <span className="flex-1 truncate text-ink">{p.title}</span>
                {selectingSlug === p.titleSlug ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-accent">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </span>
                ) : (
                  <span
                    className={`shrink-0 text-xs ${difficultyColor[p.difficulty] ?? "text-muted"}`}
                  >
                    {p.difficulty}
                  </span>
                )}
                {p.paidOnly && (
                  <span className="shrink-0 text-xs text-muted">Premium</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
