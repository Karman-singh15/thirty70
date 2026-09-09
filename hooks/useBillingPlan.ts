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

  // Reads the plan without touching state. Keeping the write out of here is
  // what lets each caller below decide whether it still wants the answer by
  // the time it arrives — and keeps the effects honest about the fact that
  // they're subscribing to an external system, not setting state on render.
  // `undefined` means "couldn't tell", which is not the same as "no plan".
  const readStatus = useCallback(async (): Promise<Plan | undefined> => {
    const res = await fetch("/api/billing/status");
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.plan as Plan;
  }, []);

  // The plan lives on the server; this subscribes to it once on mount. The
  // cancel flag matters because Sidebar unmounts on any navigation out of the
  // app layout, and a reply landing after that would be a state write to a
  // component that's gone.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await readStatus();
      if (!cancelled && current !== undefined) setPlan(current);
    })();
    return () => {
      cancelled = true;
    };
  }, [readStatus]);

  useEffect(() => {
    if (!justUpgraded.current) return;
    justUpgraded.current = false;
    router.replace("/dashboard");

    let attempt = 0;
    let cancelled = false;
    const interval = setInterval(async () => {
      attempt += 1;
      const current = await readStatus();
      if (cancelled) return;
      if (current !== undefined) setPlan(current);
      if (current === "pro" || attempt >= POLL_ATTEMPTS) {
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
