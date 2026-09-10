"use client";

import { useEffect, useRef, useState } from "react";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useAuth } from "@clerk/nextjs";
import { Lock, Pencil, Play, Send, Users, WifiOff } from "lucide-react";
// Imported for its side effect: repoints the Monaco loader at our own copy.
// Must be in place before <Editor> below first mounts.
import "@/lib/monacoSetup";
import { JudgePanel } from "@/components/JudgePanel";
import { useResolvedTheme } from "@/hooks/useTheme";
import { applyMonacoTheme, MONACO_THEME } from "@/lib/monacoTheme";
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

// How long to wait for Clerk before mounting the editor anyway.
//
// The wait below exists to order two script loads (see useMonacoSafeToLoad),
// not to gate on auth — so if Clerk never resolves, the right outcome is the
// behaviour we had before the fix (a working editor in a room that can't tell
// who you are), not an editor that never appears. Generous, because it should
// only ever be reached when Clerk is genuinely failing.
const CLERK_WAIT_TIMEOUT_MS = 5000;

/**
 * True once it's safe to mount <Editor>, which is what injects Monaco's AMD
 * `loader.js`.
 *
 * That loader installs a global `define` carrying an `amd` marker. Clerk ships
 * `clerk.browser.js` as a UMD bundle: it sniffs for exactly that marker and,
 * finding it, registers itself as an anonymous AMD module. Monaco's loader
 * accepts an anonymous define only while it is itself fetching a module, so
 * the call throws — "Can only have one anonymous define call per script file"
 * — Clerk's registration is swallowed, and clerk-js never initializes.
 *
 * The room survives that on the server (every API route authenticates from the
 * session cookie, which the browser sends regardless) but not on the client:
 * `useAuth()` never resolves, `myUserId` stays undefined, and the room quietly
 * loses its host controls and shows nobody as present.
 *
 * Monaco's own loader guards the mirror image of this — it declines to install
 * at all if an AMD `define` already exists (loader.js line ~1350) — so the two
 * coexist happily in one order and not the other. This waits for that order:
 * once Clerk has loaded, it has already made its one define call, and Monaco
 * is free to take the global.
 */
function useMonacoSafeToLoad(): boolean {
  const { isLoaded } = useAuth();
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);

  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(
      () => setWaitedLongEnough(true),
      CLERK_WAIT_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [isLoaded]);

  return isLoaded || waitedLongEnough;
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
  // Monaco takes a theme by name and can't read CSS variables, so this is the
  // one place the resolved light/dark value has to be handed over explicitly.
  // It maps to our own theme (see lib/monacoTheme.ts), not to "vs"/"vs-dark" —
  // those are Monaco's stock palettes and don't match the app's paper.
  const isDark = useResolvedTheme() === "dark";
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  // Gates the mount below — Monaco's AMD loader has to go in after Clerk's
  // UMD bundle, or Clerk never loads. See useMonacoSafeToLoad.
  const monacoSafeToLoad = useMonacoSafeToLoad();

  // Defined before the editor is created so the `theme` prop below resolves to
  // something Monaco already knows about.
  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    applyMonacoTheme(monaco, isDark);
  };

  // Re-derive on every switch. The theme is built from CSS custom properties
  // and `data-theme` is already stamped by the time this runs, so re-reading
  // them here picks up the new palette; redefining under the same name is what
  // makes Monaco repaint.
  useEffect(() => {
    if (monacoRef.current) applyMonacoTheme(monacoRef.current, isDark);
  }, [isDark]);

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
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          disabled={readOnly}
          className="rounded border border-line-strong bg-elevated px-2 py-1 text-xs text-ink focus:outline-none disabled:opacity-50"
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
            readOnly ? "text-muted" : "bg-accent-soft font-medium text-accent"
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
                className="flex items-center gap-1.5 rounded border border-line-strong bg-elevated px-2.5 py-1 text-xs font-medium text-ink hover:bg-line-strong disabled:cursor-not-allowed disabled:opacity-50"
                title="Run against the public example test cases"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
              <button
                onClick={onSubmit}
                disabled={judgeState?.status === "loading"}
                className="flex items-center gap-1.5 rounded bg-accent-hover px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                title="Submit to LeetCode"
              >
                <Send className="h-3 w-3" />
                Submit
              </button>
            </>
          )}
          {writerLabel && (
            <span className="flex items-center gap-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
              <Users className="h-3 w-3" />
              {writerLabel.name} · Ln {writerLabel.lineNumber}, Col {writerLabel.column}
            </span>
          )}
          {!connected && (
            <span
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-warn"
              title="Live updates are down — falling back to periodic refresh"
            >
              <WifiOff className="h-3 w-3" />
              Reconnecting
            </span>
          )}
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {!monacoSafeToLoad ? (
          // Monaco's own `loading` slot can't serve here: reaching it would
          // mean <Editor> has already mounted, which is the thing being
          // deferred. Same neutral surface, so there's no flash when the real
          // editor takes over.
          <div className="flex h-full items-center justify-center text-xs text-muted">
            Loading editor…
          </div>
        ) : (
          <Editor
            height="100%"
            beforeMount={handleBeforeMount}
            language={language}
            defaultValue=""
            onMount={handleMount}
            theme={MONACO_THEME}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12 },
              // See lib/monacoTheme.ts: the default rainbow brackets were the
              // one thing on screen picking its own colours.
              bracketPairColorization: { enabled: false },
              readOnly,
            }}
          />
        )}
        {judgeState && onCloseJudge && (
          <JudgePanel state={judgeState} isSelf={isJudgeSelf} onClose={onCloseJudge} />
        )}
      </div>
    </div>
  );
}
