"use client";

import { useCallback, useState } from "react";

// Tracks which server round trips are currently in flight, keyed by name, so
// the button that started one can show that it's working. Keyed rather than a
// single boolean because several can overlap — pausing the timer while a
// problem is still being loaded, say — and each control should only reflect
// its own request.
export function usePendingActions() {
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const run = useCallback(async (key: string, action: () => Promise<unknown>) => {
    setPending((prev) => ({ ...prev, [key]: true }));
    try {
      await action();
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, []);

  const isPending = useCallback((key: string) => !!pending[key], [pending]);
  const anyPending = Object.keys(pending).length > 0;

  return { run, isPending, anyPending };
}
