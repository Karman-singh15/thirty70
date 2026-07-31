"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Code2 } from "lucide-react";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-6 py-3">
      <Link href="/dashboard" className="flex items-center gap-2 text-zinc-100">
        <Code2 className="h-6 w-6 text-emerald-400" />
        <span className="text-lg font-semibold tracking-tight">Thirty70</span>
      </Link>
      <UserButton />
    </header>
  );
}
