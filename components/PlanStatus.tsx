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
      <div className="rounded-2xl border border-warn-line bg-warn/[0.04] p-6">
        <div className="flex items-center gap-2">
          <Crown className="h-4.5 w-4.5 text-warn" />
          <h3 className="font-medium text-ink">You&apos;re on Pro</h3>
        </div>
        <ul className="mt-4 space-y-2">
          {PRO_PERKS.map((perk) => (
            <li
              key={perk}
              className="flex items-center gap-2 text-sm text-muted"
            >
              <Check className="h-3.5 w-3.5 shrink-0 text-warn" />
              {perk}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-medium text-ink">Free plan</h3>
        <button
          onClick={upgrade}
          disabled={upgrading || plan === null}
          className="flex items-center gap-1.5 rounded-lg bg-warn px-3.5 py-2 text-xs font-semibold text-on-accent transition hover:bg-warn disabled:cursor-wait disabled:opacity-60"
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
            className="flex items-center gap-2 text-sm text-muted"
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-faint" />
            {perk}
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  );
}
