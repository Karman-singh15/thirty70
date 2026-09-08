import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-4 text-center">
      <span className="font-mono text-sm text-zinc-600">404</span>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
        Nothing here
      </h1>
      <p className="max-w-xs text-sm text-zinc-500">
        The room may have ended, or the link&apos;s off. Head back and start a
        new one.
      </p>
      <Link
        href="/"
        className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back home
      </Link>
    </div>
  );
}
