"use client";

import type { LeetCodeProblemDetail } from "@/lib/leetcode";

interface ProblemPanelProps {
  problem: LeetCodeProblemDetail | null;
  loading: boolean;
}

const difficultyColor: Record<string, string> = {
  Easy: "text-success bg-success-soft",
  Medium: "text-warn bg-warn-soft",
  Hard: "text-danger bg-danger-soft",
};

export function ProblemPanel({ problem, loading }: ProblemPanelProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading problem...
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <p className="text-sm">No problem selected</p>
        <p className="text-xs">Search for a LeetCode problem above</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">{problem.questionFrontendId}.</span>
          <h2 className="text-base font-semibold text-ink">{problem.title}</h2>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${difficultyColor[problem.difficulty] ?? ""}`}
          >
            {problem.difficulty}
          </span>
        </div>
      </div>

      <div
        className="prose prose-invert prose-sm max-w-none flex-1 overflow-y-auto px-4 py-4 prose-p:text-ink-soft prose-pre:bg-surface prose-pre:text-ink prose-code:text-accent-hover"
        dangerouslySetInnerHTML={{ __html: problem.content }}
      />

      {problem.hints.length > 0 && (
        <details className="border-t border-line px-4 py-3">
          <summary className="cursor-pointer text-sm text-muted hover:text-ink">
            Hints ({problem.hints.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {problem.hints.map((hint, i) => (
              <li key={i}>{hint}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
