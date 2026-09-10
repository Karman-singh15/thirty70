"use client";

import { useState } from "react";
import { AtSign, Check } from "lucide-react";
import { useSocial } from "@/hooks/useSocial";
import { Spinner } from "@/components/Spinner";
import {
  USERNAME_MAX_LENGTH,
  normalizeUsername,
  validateUsername,
} from "@/lib/username";

// Changing an existing handle, from /settings. The first claim happens in the
// dialog that greets a new account (UsernameDialog); this is the same PATCH
// with room to think about it.

export function UsernameSetting() {
  const { profile, profileLoaded, chooseUsername } = useSocial();
  const current = profile?.username ?? null;

  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // The handle the field was last seeded from. The profile arrives after the
  // first render (and can change again if another tab renames it), so the
  // input has to re-seed — but only when the *stored* handle moves, never
  // when the person is mid-edit.
  const [seededFrom, setSeededFrom] = useState(current);

  // Adjusted during render rather than in an effect: React re-runs this
  // component immediately with the new state and never commits the stale
  // frame, so the field can't flash the old handle. This is the documented
  // pattern for deriving state from a changed prop.
  if (seededFrom !== current) {
    setSeededFrom(current);
    setValue(current ?? "");
    setError(null);
    setSaved(false);
  }

  if (!profileLoaded) {
    return (
      <div className="h-[104px] animate-pulse rounded-2xl border border-line bg-surface" />
    );
  }

  const normalized = normalizeUsername(value);
  const unchanged = normalized === current;
  const localProblem = value.trim() ? validateUsername(value) : null;
  const message = error ?? localProblem;
  const canSave = !saving && !unchanged && validateUsername(value) === null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await chooseUsername(value);
    setSaving(false);

    if (result.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={save} className="rounded-2xl border border-line bg-surface p-5">
      <label htmlFor="username-input" className="text-sm font-medium text-ink">
        Username
      </label>
      <p className="mt-1 text-sm text-muted">
        How friends find you when they search. Changing it doesn&apos;t affect
        your existing friends.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <div
            className={`flex items-center gap-1.5 rounded-lg border bg-canvas px-3 transition ${
              message ? "border-danger-line" : "border-line focus-within:border-line-strong"
            }`}
          >
            <AtSign className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              id="username-input"
              value={value}
              onChange={(e) => {
                setValue(normalizeUsername(e.target.value));
                setError(null);
                setSaved(false);
              }}
              maxLength={USERNAME_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={message ? true : undefined}
              placeholder="yourname"
              className="w-full bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-faint"
            />
          </div>
          <p
            className={`mt-1.5 min-h-[1.25rem] text-xs ${
              message ? "text-danger" : "text-faint"
            }`}
            role={error ? "alert" : undefined}
          >
            {message ?? "3–20 characters. Letters, numbers and underscores."}
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSave}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <Spinner className="h-3.5 w-3.5" />}
          {saved && <Check className="h-3.5 w-3.5 text-success" />}
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>
    </form>
  );
}
