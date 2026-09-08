"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type Plan = "free" | "pro" | null;

// Webhook processing lags the checkout redirect by a beat, so a fresh
// "?upgrade=success" bounce polls briefly instead of showing "Free" for a
// plan that's actually already pro.
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2000;

export function useBillingPlan() {
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

  const upgrade = useCallback(async () => {
    setError(null);
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      // A route crash before it can call NextResponse.json() (an uncaught
      // throw, a redirect from middleware) lands here as a non-JSON body —
      // don't let that surface as "Unexpected end of JSON input".
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "Could not start checkout");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setUpgrading(false);
    }
  }, []);

  return { plan, upgrading, error, upgrade };
}
