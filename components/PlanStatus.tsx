"use client";

import { Crown, Loader2, Check } from "lucide-react";
import { MAX_ROOM_PARTICIPANTS, MAX_ROOM_PARTICIPANTS_PRO } from "@/lib/roomLimits";
import { useBillingPlan } from "@/hooks/useBillingPlan";

const FREE_PERKS = [`Rooms up to ${MAX_ROOM_PARTICIPANTS} people`, "Unlimited free-tier problems"];
const PRO_PERKS = [
  `Rooms up to ${MAX_ROOM_PARTICIPANTS_PRO} people`,
  "Priority room capacity",
  "Support the project",
];

export function PlanStatus() {
  const { plan, upgrading, error, upgrade } = useBillingPlan();

  if (plan === "pro") {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-6">
        <div className="flex items-center gap-2">
          <Crown className="h-4.5 w-4.5 text-amber-400" />
          <h3 className="font-medium text-zinc-100">You&apos;re on Pro</h3>
        </div>
        <ul className="mt-4 space-y-2">
          {PRO_PERKS.map((perk) => (
            <li
              key={perk}
              className="flex items-center gap-2 text-sm text-zinc-400"
            >
              <Check className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              {perk}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-medium text-zinc-100">Free plan</h3>
        <button
          onClick={upgrade}
          disabled={upgrading || plan === null}
          className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
        >
          {upgrading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Crown className="h-3.5 w-3.5" />
          )}
          {upgrading ? "Redirecting…" : "Upgrade to Pro"}
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {FREE_PERKS.map((perk) => (
          <li
            key={perk}
            className="flex items-center gap-2 text-sm text-zinc-400"
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            {perk}
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}
