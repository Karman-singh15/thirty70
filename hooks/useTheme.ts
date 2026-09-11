"use client";

import { useCallback, useSyncExternalStore } from "react";

// Three states, not two. "system" is a real preference and collapsing it into
// a light/dark boolean loses it: someone who never chose anything should keep
// following their OS when it flips at sunset, while someone who explicitly
// chose light should stay light at midnight. A new viewer starts on "system" —
// the absence of a stored key and an explicit "system" mean the same thing.
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
// Same-tab updates: the `storage` event only fires in *other* tabs, so a click
// on the toggle wouldn't notify the hook in the tab that made it.
const CHANGE_EVENT = "leetduel:themechange";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private mode, or storage blocked. Following the OS is the right default.
  }
  return "system";
}

function resolve(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function apply(preference: ThemePreference): void {
  document.documentElement.setAttribute("data-theme", resolve(preference));
}

// This is an external store (localStorage + the OS media query), not React
// state, so useSyncExternalStore is the correct primitive. It also sidesteps
// hydrating from localStorage inside an effect, which would trip the
// react-hooks/set-state-in-effect rule this project treats as an error.
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);

  // When the OS flips and the user is on "system", the attribute has to be
  // rewritten as well as re-rendered — the CSS fallback media query only
  // applies when no data-theme is set, and by now the boot script has set one.
  const onSystemChange = () => {
    apply(readPreference());
    onChange();
  };

  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onSystemChange);
  media.addEventListener("change", onSystemChange);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onSystemChange);
    media.removeEventListener("change", onSystemChange);
  };
}

// The server has no way to know the viewer's preference, so it renders the
// default one. The boot script has already painted the correct colours by
// then; this only affects which segment of the toggle looks selected for the
// first frame.
const getServerSnapshot = (): ThemePreference => "system";

// What the page is actually painted as right now, with "system" already
// resolved. Components that have to hand a concrete light/dark value to a
// third party — Monaco, which takes a theme name rather than reading CSS
// variables — need this rather than the raw preference.
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribe,
    () => resolve(readPreference()),
    () => "light" as const
  );
}

export function useTheme() {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    getServerSnapshot
  );

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Can't persist it; still apply it for this page view.
    }
    apply(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { preference, setPreference };
}
