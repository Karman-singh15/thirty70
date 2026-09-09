import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-4 text-center">
      <span className="font-mono text-sm text-faint">404</span>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Nothing here
      </h1>
      <p className="max-w-xs text-sm text-muted">
        The room may have ended, or the link&apos;s off. Head back and start a
        new one.
      </p>
      <Link
        href="/"
        className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back home
      </Link>
    </div>
  );
}
