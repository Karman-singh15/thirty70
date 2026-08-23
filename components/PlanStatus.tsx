"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Crown, Loader2 } from "lucide-react";
import { MAX_ROOM_PARTICIPANTS_PRO } from "@/lib/roomLimits";

type Plan = "free" | "pro" | null;

// Webhook processing lags the checkout redirect by a beat, so a fresh
// "?upgrade=success" bounce polls briefly instead of showing "Free" for a
// plan that's actually already pro.
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2000;

export function PlanStatus() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState<Plan>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const justUpgraded = useRef(searchParams.get("upgrade") === "success");

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/billing/status");
    if (!res.ok) return null;
    const data = await res.json();
    setPlan(data.plan);
    return data.plan as Plan;
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!justUpgraded.current) return;
    justUpgraded.current = false;
    router.replace("/dashboard");

    let attempt = 0;
    const interval = setInterval(async () => {
      attempt += 1;
      const current = await fetchStatus();
      if (current === "pro" || attempt >= POLL_ATTEMPTS) {
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // Only ever runs once, right after the redirect back from checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpgrade() {
    setError(null);
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start checkout");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setUpgrading(false);
    }
  }

  if (plan === "pro") {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
        <Crown className="h-3.5 w-3.5" />
        Pro — rooms up to {MAX_ROOM_PARTICIPANTS_PRO}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleUpgrade}
        disabled={upgrading || plan === null}
        className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 disabled:cursor-wait disabled:opacity-60"
      >
        {upgrading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
        {upgrading ? "Redirecting…" : "Upgrade to Pro"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
