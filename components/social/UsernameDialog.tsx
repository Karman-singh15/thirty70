"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign } from "lucide-react";
import { useSocial } from "@/hooks/useSocial";
import { Spinner } from "@/components/Spinner";
import {
  USERNAME_MAX_LENGTH,
  normalizeUsername,
  validateUsername,
} from "@/lib/username";

// Shown once, over the app, the first time someone arrives without a handle.
//
// Deliberately not dismissible: a username isn't a profile nicety here, it's
// the only way another person can find you, and every other social surface —
// search, requests, the room invite dropdown — is inert without one. Letting
// it be skipped would mean building a second, worse version of this prompt in
// each of those places. It's mounted inside the (app) group only, so the
// marketing pages and the sign-in flow are untouched.
export function UsernameDialog() {
  const { needsUsername, chooseUsername } = useSocial();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (needsUsername) inputRef.current?.focus();
  }, [needsUsername]);

  if (!needsUsername) return null;

  // Local rules first, so "too short" and "bad characters" answer instantly
  // and don't cost a round trip. Uniqueness is the one question only the
  // server can answer, and it's the one this waits for.
  const localProblem = value.trim() ? validateUsername(value) : null;
  const message = error ?? localProblem;
  const canSubmit = !saving && validateUsername(value) === null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    const result = await chooseUsername(value);
    setSaving(false);

    // On success the dialog unmounts on its own — `needsUsername` goes false
    // the moment the profile in context carries a username.
    if (!result.ok) {
      setError(result.error);
      inputRef.current?.select();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="username-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/40"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
          <AtSign className="h-5 w-5 text-accent" />
        </div>

        <h2
          id="username-dialog-title"
          className="mt-4 text-base font-medium text-ink"
        >
          Pick a username
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This is how friends find you and send you room invites. You can change
          it later in settings.
        </p>

        <form onSubmit={submit} className="mt-5">
          <div
            className={`flex items-center gap-1.5 rounded-lg border bg-canvas px-3 transition ${
              message ? "border-danger-line" : "border-line focus-within:border-line-strong"
            }`}
          >
            <AtSign className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                // Normalized as you type rather than on submit, so the field
                // always shows the handle you'll actually get — otherwise
                // "Alice" is accepted and "alice" is what appears afterwards.
                setValue(normalizeUsername(e.target.value));
                setError(null);
              }}
              maxLength={USERNAME_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Username"
              aria-invalid={message ? true : undefined}
              placeholder="yourname"
              className="w-full bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-faint"
            />
          </div>

          {/* Reserves its line whether or not there's a message, so the
              button doesn't jump when an error appears. */}
          <p
            className={`mt-2 min-h-[1.25rem] text-xs ${
              message ? "text-danger" : "text-faint"
            }`}
            role={error ? "alert" : undefined}
          >
            {message ?? "3–20 characters. Letters, numbers and underscores."}
          </p>

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            {saving ? "Claiming…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
