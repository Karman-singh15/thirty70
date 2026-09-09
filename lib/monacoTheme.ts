import type { OnMount } from "@monaco-editor/react";

// Monaco takes a theme by name and can't read CSS variables, so the editor was
// left on the stock "vs"/"vs-dark". Those don't belong to this design: stock
// light is #FFFFFE against our #FBFBF9 paper, and stock dark is #1E1E1E — a
// cool grey — against our warm #141311. The editor is the largest surface on
// the room page, so it reading as "default Monaco" undoes the whole direction.
//
// Rather than hard-code a second copy of the palette here (which would drift
// the first time globals.css changes), the theme is *derived from the CSS
// variables at runtime*. One source of truth, and it follows any future
// palette edit for free.

export const MONACO_THEME = "thirty70";

/** Monaco wants `RRGGBB`; the tokens are already `#rrggbb`. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  // Only solid hex is usable — the rgba() tokens (…-soft, …-line) are not.
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

type MonacoApi = Parameters<OnMount>[1];

/**
 * (Re)defines the editor theme from the current CSS custom properties and
 * applies it. Call it whenever the resolved theme changes: `data-theme` is
 * already stamped by then, so the variables read here are the new palette.
 */
export function applyMonacoTheme(monaco: MonacoApi, isDark: boolean): void {
  const canvas = token("--canvas", isDark ? "#141311" : "#fbfbf9");
  const surface = token("--surface", isDark ? "#1c1b18" : "#f4f4f1");
  const elevated = token("--elevated", isDark ? "#24231f" : "#edede8");
  const line = token("--line", isDark ? "#2e2d28" : "#dedcd4");
  const lineStrong = token("--line-strong", isDark ? "#454339" : "#c9c6bb");
  const ink = token("--ink", isDark ? "#edebe3" : "#1b1b19");
  const inkSoft = token("--ink-soft", isDark ? "#c9c6ba" : "#45453f");
  const muted = token("--muted", isDark ? "#8e8b7f" : "#83837a");
  const faint = token("--faint", isDark ? "#6a6860" : "#a5a599");
  const live = token("--live", isDark ? "#d08a3e" : "#8a4b12");
  const success = token("--success", isDark ? "#7fb069" : "#2f6a2f");
  const danger = token("--danger", isDark ? "#e08b7e" : "#9e2b2b");

  // Monaco's rule colours are hex *without* the leading #.
  const bare = (hex: string) => hex.replace("#", "");

  monaco.editor.defineTheme(MONACO_THEME, {
    // Inheriting keeps the hundreds of scopes we don't name from falling back
    // to unstyled black.
    base: isDark ? "vs-dark" : "vs",
    inherit: true,
    // The same restraint as the rest of the app: rust for keywords because
    // they're the live structure of the code, green for strings, and
    // everything else in the ink greys. No blues, no purples.
    rules: [
      { token: "", foreground: bare(ink), background: bare(canvas) },
      { token: "comment", foreground: bare(muted), fontStyle: "italic" },
      { token: "keyword", foreground: bare(live) },
      { token: "keyword.control", foreground: bare(live) },
      { token: "operator", foreground: bare(muted) },
      { token: "delimiter", foreground: bare(muted) },
      { token: "string", foreground: bare(success) },
      { token: "string.escape", foreground: bare(live) },
      { token: "number", foreground: bare(live) },
      { token: "regexp", foreground: bare(success) },
      { token: "type", foreground: bare(inkSoft) },
      { token: "type.identifier", foreground: bare(inkSoft) },
      { token: "identifier", foreground: bare(ink) },
      { token: "variable", foreground: bare(ink) },
      { token: "variable.predefined", foreground: bare(inkSoft) },
      { token: "function", foreground: bare(ink) },
      { token: "tag", foreground: bare(live) },
      { token: "attribute.name", foreground: bare(inkSoft) },
      { token: "attribute.value", foreground: bare(success) },
      { token: "invalid", foreground: bare(danger) },
    ],
    colors: {
      "editor.background": canvas,
      "editor.foreground": ink,
      "editorGutter.background": canvas,
      "editorLineNumber.foreground": faint,
      "editorLineNumber.activeForeground": inkSoft,
      "editor.lineHighlightBackground": surface,
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": elevated,
      "editor.inactiveSelectionBackground": surface,
      "editor.selectionHighlightBackground": elevated,
      "editor.wordHighlightBackground": elevated,
      "editor.wordHighlightStrongBackground": elevated,
      // The caret is rust for the same reason the collaborator's caret is:
      // it's the live thing on screen.
      "editorCursor.foreground": live,
      "editorWhitespace.foreground": line,
      "editorIndentGuide.background1": line,
      "editorIndentGuide.activeBackground1": lineStrong,
      "editorBracketMatch.background": elevated,
      "editorBracketMatch.border": lineStrong,
      "editorWidget.background": surface,
      "editorWidget.border": line,
      "editorSuggestWidget.background": surface,
      "editorSuggestWidget.border": line,
      "editorSuggestWidget.selectedBackground": elevated,
      "editorHoverWidget.background": surface,
      "editorHoverWidget.border": line,
      "editorError.foreground": danger,
      "editorWarning.foreground": live,
      "scrollbarSlider.background": line,
      "scrollbarSlider.hoverBackground": lineStrong,
      "scrollbarSlider.activeBackground": lineStrong,
      "editorOverviewRuler.border": line,
      // Bracket-pair colourisation ships on by default with a six-hue rainbow
      // (blues, yellows, purples) that blows straight through the one-accent
      // rule — it was the only colour on screen we hadn't chosen. It's turned
      // off in the editor options; these keep it on-palette should anyone
      // switch it back on.
      "editorBracketHighlight.foreground1": muted,
      "editorBracketHighlight.foreground2": inkSoft,
      "editorBracketHighlight.foreground3": faint,
      "editorBracketHighlight.foreground4": muted,
      "editorBracketHighlight.foreground5": inkSoft,
      "editorBracketHighlight.foreground6": faint,
      "editorBracketHighlight.unexpectedBracket.foreground": danger,
    },
  });

  monaco.editor.setTheme(MONACO_THEME);
}
