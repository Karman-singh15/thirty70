"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import type { JudgeResult, JudgeStage } from "@/lib/leetcodeBridge";
import type { JudgeBroadcast } from "@/lib/editorDoc";

interface JudgePanelProps {
  state: JudgeBroadcast;
  // Whether the viewer is the one who triggered this run/submit — controls
  // whether the header says "you" or names the actor.
  isSelf: boolean;
  onClose: () => void;
}

const STAGE_LABEL: Record<JudgeStage, string> = {
  opening: "Opening LeetCode in the background…",
  running: "Running against the example test cases…",
  submitting: "Submitting to LeetCode…",
};

export function JudgePanel({ state, isSelf, onClose }: JudgePanelProps) {
  // Slide up on mount instead of appearing instantly — this panel replaces
  // itself in place (loading -> result) rather than unmounting between
  // states, so the slide only needs to run once per Run/Submit click.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const verb =
    state.status === "loading"
      ? state.mode === "run"
        ? "running"
        : "submitting"
      : state.mode === "run"
        ? "run result"
        : "submit result";
  const title = isSelf
    ? verb.charAt(0).toUpperCase() + verb.slice(1)
    : `${state.name} — ${verb}`;

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-10 flex h-1/2 flex-col border-t border-zinc-700 bg-zinc-900 shadow-[0_-8px_24px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out ${
        mounted ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {state.status === "loading" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">{STAGE_LABEL[state.stage]}</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <XCircle className="h-6 w-6 text-red-400" />
            <p className="text-sm text-red-300">{state.message}</p>
          </div>
        )}

        {state.status === "result" && state.result.mode === "run" && <RunResult result={state.result} />}
        {state.status === "result" && state.result.mode === "submit" && (
          <SubmitResult result={state.result} />
        )}
      </div>
    </div>
  );
}

function RunResult({ result }: { result: Extract<JudgeResult, { mode: "run" }> }) {
  if (result.compileError) {
    return <ErrorBlock label="Compile Error" message={result.compileError} />;
  }
  if (result.runtimeError) {
    return <ErrorBlock label="Runtime Error" message={result.runtimeError} />;
  }

  const allPassed = result.totalCorrect === result.totalTestcases;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {allPassed ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : (
          <XCircle className="h-4 w-4 text-red-400" />
        )}
        <span className={`text-sm font-medium ${allPassed ? "text-emerald-400" : "text-red-400"}`}>
          {result.totalCorrect} / {result.totalTestcases} testcases passed
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {result.cases.map((c) => (
          <div
            key={c.index}
            className={`rounded border px-3 py-2 text-xs ${
              c.passed ? "border-emerald-900 bg-emerald-500/5" : "border-red-900 bg-red-500/5"
            }`}
          >
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              {c.passed ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-400" />
              )}
              <span className={c.passed ? "text-emerald-300" : "text-red-300"}>
                Case {c.index + 1}
              </span>
            </div>
            {!c.passed && (
              <div className="grid grid-cols-2 gap-2 font-mono text-zinc-400">
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Output</div>
                  <div className="break-all text-zinc-300">{c.actual || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Expected</div>
                  <div className="break-all text-zinc-300">{c.expected || "—"}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SubmitResult({ result }: { result: Extract<JudgeResult, { mode: "submit" }> }) {
  if (result.compileError) {
    return <ErrorBlock label="Compile Error" message={result.compileError} />;
  }
  if (result.runtimeError) {
    return <ErrorBlock label="Runtime Error" message={result.runtimeError} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {result.accepted ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        ) : (
          <XCircle className="h-5 w-5 text-red-400" />
        )}
        <span className={`text-base font-semibold ${result.accepted ? "text-emerald-400" : "text-red-400"}`}>
          {result.status}
        </span>
      </div>

      {result.totalTestcases !== null && (
        <p className="text-xs text-zinc-400">
          {result.totalCorrect} / {result.totalTestcases} testcases passed
        </p>
      )}

      {result.accepted && (
        <div className="grid grid-cols-2 gap-3 text-xs text-zinc-400">
          <div>
            <div className="text-[10px] uppercase text-zinc-500">Runtime</div>
            <div className="text-zinc-200">
              {result.runtime ?? "—"}
              {result.runtimePercentile != null && (
                <span className="ml-1 text-zinc-500">
                  (beats {result.runtimePercentile.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-zinc-500">Memory</div>
            <div className="text-zinc-200">
              {result.memory ?? "—"}
              {result.memoryPercentile != null && (
                <span className="ml-1 text-zinc-500">
                  (beats {result.memoryPercentile.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {result.failingCase && (
        <div className="rounded border border-red-900 bg-red-500/5 px-3 py-2">
          <div className="mb-2 text-xs font-medium text-red-400">First failing testcase</div>
          <div className="flex flex-col gap-2 font-mono text-xs">
            <div>
              <div className="text-[10px] uppercase text-zinc-500">Input</div>
              <div className="whitespace-pre-wrap break-all text-zinc-300">
                {result.failingCase.input || "—"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] uppercase text-zinc-500">Output</div>
                <div className="break-all text-zinc-300">{result.failingCase.actual || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-zinc-500">Expected</div>
                <div className="break-all text-zinc-300">{result.failingCase.expected || "—"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorBlock({ label, message }: { label: string; message: string }) {
  return (
    <div className="rounded border border-red-900 bg-red-500/5 px-3 py-2">
      <div className="mb-1 text-xs font-medium text-red-400">{label}</div>
      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-zinc-300">{message}</pre>
    </div>
  );
}
