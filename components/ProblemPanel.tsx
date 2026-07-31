"use client";

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

interface ProblemPanelProps {
  problem: ProblemDetail | null;
  loading: boolean;
}

const difficultyColor: Record<string, string> = {
  Easy: "text-emerald-400 bg-emerald-400/10",
  Medium: "text-amber-400 bg-amber-400/10",
  Hard: "text-red-400 bg-red-400/10",
};

export function ProblemPanel({ problem, loading }: ProblemPanelProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Loading problem...
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
        <p className="text-sm">No problem selected</p>
        <p className="text-xs">Search for a LeetCode problem above</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">{problem.questionFrontendId}.</span>
          <h2 className="text-base font-semibold text-zinc-100">{problem.title}</h2>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${difficultyColor[problem.difficulty] ?? ""}`}
          >
            {problem.difficulty}
          </span>
        </div>
      </div>

      <div
        className="prose prose-invert prose-sm max-w-none flex-1 overflow-y-auto px-4 py-4 prose-p:text-zinc-300 prose-pre:bg-zinc-900 prose-pre:text-zinc-200 prose-code:text-emerald-300"
        dangerouslySetInnerHTML={{ __html: problem.content }}
      />

      {problem.hints.length > 0 && (
        <details className="border-t border-zinc-800 px-4 py-3">
          <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">
            Hints ({problem.hints.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-zinc-400">
            {problem.hints.map((hint, i) => (
              <li key={i}>{hint}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
