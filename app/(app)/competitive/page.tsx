"use client";

import { useState } from "react";
import { Swords, Trophy, Check, Timer } from "lucide-react";

export default function CompetitivePage() {
  const [notified, setNotified] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-3 py-1 text-xs font-medium text-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" />
        In development
      </span>

      <h1 className="mt-5 text-3xl font-semibold tracking-tight text-ink">
        Competitive mode
      </h1>
      <p className="mt-2.5 max-w-lg text-muted">
        Same problem, separate editors, one clock. Competitive rooms turn
        practice into a race — first correct submission takes it.
      </p>

      {!notified ? (
        <button
          onClick={() => setNotified(true)}
          className="mt-6 flex items-center gap-2 rounded-xl bg-inverse px-5 py-2.5 text-sm font-medium text-on-inverse transition hover:bg-inverse-hover active:scale-[0.98]"
        >
          Notify me when it&apos;s live
        </button>
      ) : (
        <p className="mt-6 flex items-center gap-2 text-sm font-medium text-accent">
          <Check className="h-4 w-4" />
          You&apos;ll hear from us when it opens up.
        </p>
      )}

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface">
            <Swords className="h-4.5 w-4.5 text-warn" />
          </div>
          <h3 className="mt-4 font-medium text-ink">1v1 duels</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Challenge someone directly. Same problem drops for both of you
            at once, editors stay private until someone submits.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface">
            <Trophy className="h-4.5 w-4.5 text-warn" />
          </div>
          <h3 className="mt-4 font-medium text-ink">Brackets</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Run a small tournament with your study group — single
            elimination, one problem per round.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-4 text-sm text-muted">
        <Timer className="h-4 w-4 shrink-0" />
        Rooms already have a shared turn timer — competitive mode reuses it,
        just with the clock running for both sides at once instead of
        rotating.
      </div>
    </div>
  );
}
