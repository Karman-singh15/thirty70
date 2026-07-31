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
  onSelect: (problem: ProblemSummary) => void;
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
                onClick={() => {
                  onSelect(p);
                  setQuery("");
                  setResults([]);
                }}
                disabled={p.paidOnly}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="w-8 shrink-0 text-zinc-500">{p.frontendQuestionId}</span>
                <span className="flex-1 truncate text-zinc-200">{p.title}</span>
                <span className={`shrink-0 text-xs ${difficultyColor[p.difficulty] ?? "text-zinc-400"}`}>
                  {p.difficulty}
                </span>
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
