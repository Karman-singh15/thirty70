"use client";

import Editor, { OnMount } from "@monaco-editor/react";
import { Lock, Pencil, Play, Send, Users, WifiOff } from "lucide-react";
// Imported for its side effect: repoints the Monaco loader at our own copy.
// Must be in place before <Editor> below first mounts.
import "@/lib/monacoSetup";
import { JudgePanel } from "@/components/JudgePanel";
import type { JudgeBroadcast } from "@/lib/editorDoc";

interface CodeEditorProps {
  language: string;
  onLanguageChange: (language: string) => void;
  // Hands the editor instance to the sync layer, which drives the model
  // directly from then on — hence no `value` prop below.
  onEditorMount: OnMount;
  readOnly?: boolean;
  // Set when someone else is typing, so their position can be named.
  writerLabel?: { name: string; lineNumber: number; column: number } | null;
  connected?: boolean;
  // Whether a problem is loaded — Run/Submit stay hidden until then. The
  // buttons are further gated by `readOnly`: only the turn holder gets them,
  // same as editing.
  canJudge?: boolean;
  onRun?: () => void;
  onSubmit?: () => void;
  // The room's current Run/Submit state, broadcast to everyone — not just
  // whoever clicked — so the whole room can watch a run/submit together.
  judgeState?: JudgeBroadcast | null;
  isJudgeSelf?: boolean;
  onCloseJudge?: () => void;
}

const LANGUAGES = [
  { label: "JavaScript", value: "javascript" },
  { label: "Python", value: "python" },
  { label: "Java", value: "java" },
  { label: "C++", value: "cpp" },
  { label: "Go", value: "go" },
  { label: "TypeScript", value: "typescript" },
];

export function CodeEditor({
  language,
  onLanguageChange,
  onEditorMount,
  readOnly = false,
  writerLabel = null,
  connected = true,
  canJudge = false,
  onRun,
  onSubmit,
  judgeState = null,
  isJudgeSelf = false,
  onCloseJudge,
}: CodeEditorProps) {
  // Monaco types keystrokes into a hidden textarea, and browsers (plus
  // extensions like Grammarly) run spellcheck against it by default — which
  // shows up as red squiggles under code tokens that aren't real Monaco
  // diagnostics. Opting that textarea out fixes it.
  const handleMount: OnMount = (editor, monaco) => {
    const textarea = editor.getDomNode()?.querySelector("textarea");
    if (textarea) {
      textarea.setAttribute("spellcheck", "false");
      textarea.setAttribute("data-gramm", "false");
      textarea.setAttribute("data-gramm_editor", "false");
      textarea.setAttribute("data-enable-grammarly", "false");
    }
    onEditorMount(editor, monaco);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          disabled={readOnly}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none disabled:opacity-50"
          title={
            readOnly
              ? "The language is shared — only the current player can change it"
              : "Shared with everyone in the room"
          }
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
        <span
          className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs ${
            readOnly ? "text-zinc-500" : "bg-emerald-500/10 font-medium text-emerald-400"
          }`}
        >
          {readOnly ? (
            <>
              <Lock className="h-3 w-3" />
              Read-only — not your turn
            </>
          ) : (
            <>
              <Pencil className="h-3 w-3" />
              You can edit
            </>
          )}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {canJudge && !readOnly && (
            <>
              <button
                onClick={onRun}
                disabled={judgeState?.status === "loading"}
                className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                title="Run against the public example test cases"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
              <button
                onClick={onSubmit}
                disabled={judgeState?.status === "loading"}
                className="flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                title="Submit to LeetCode"
              >
                <Send className="h-3 w-3" />
                Submit
              </button>
            </>
          )}
          {writerLabel && (
            <span className="flex items-center gap-1.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
              <Users className="h-3 w-3" />
              {writerLabel.name} · Ln {writerLabel.lineNumber}, Col {writerLabel.column}
            </span>
          )}
          {!connected && (
            <span
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-amber-400"
              title="Live updates are down — falling back to periodic refresh"
            >
              <WifiOff className="h-3 w-3" />
              Reconnecting
            </span>
          )}
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          defaultValue=""
          onMount={handleMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12 },
            readOnly,
          }}
        />
        {judgeState && onCloseJudge && (
          <JudgePanel state={judgeState} isSelf={isJudgeSelf} onClose={onCloseJudge} />
        )}
      </div>
    </div>
  );
}
