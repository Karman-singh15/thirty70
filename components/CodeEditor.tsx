"use client";

import Editor, { OnMount } from "@monaco-editor/react";
import { Lock, Pencil, Users, WifiOff } from "lucide-react";

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
}: CodeEditorProps) {
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
      <div className="flex-1">
        <Editor
          height="100%"
          language={language}
          defaultValue=""
          onMount={onEditorMount}
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
      </div>
    </div>
  );
}
