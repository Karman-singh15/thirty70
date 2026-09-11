"use client";

import { useEffect } from "react";

// The last resort: an error thrown by the root layout itself, which app/error.tsx
// sits inside and therefore cannot catch. It replaces the whole document, so it
// has to render its own <html> and <body> — and it cannot rely on the app's
// fonts or theme tokens, since the failure may be in the very layout that
// provides them. Hence the inline styles.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "render.global_boundary",
        at: new Date().toISOString(),
        message: error.message,
        digest: error.digest ?? null,
      })
    );
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          padding: "24px",
          textAlign: "center",
          background: "#fbfbf9",
          color: "#1b1b19",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "22px", letterSpacing: "-0.02em" }}>
          LeetDuel failed to load
        </h1>
        <p style={{ margin: 0, maxWidth: "34ch", fontSize: "14px", color: "#83837a", lineHeight: 1.6 }}>
          Something went wrong before the app could start. Reloading usually
          fixes it.
        </p>
        {error.digest && (
          <p style={{ margin: 0, fontSize: "11px", color: "#a5a599" }}>ref {error.digest}</p>
        )}
        <button
          onClick={reset}
          style={{
            marginTop: "6px",
            padding: "9px 18px",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "inherit",
            color: "#fbfbf9",
            background: "#1b1b19",
            border: 0,
            borderRadius: "2px",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
