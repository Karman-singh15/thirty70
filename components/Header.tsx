"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Code2 } from "lucide-react";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-line bg-canvas px-6 py-3">
      <Link href="/dashboard" className="flex items-center gap-2 text-ink">
        <Code2 className="h-6 w-6 text-accent" />
        <span className="text-lg font-semibold tracking-tight">Thirty70</span>
      </Link>
      <UserButton />
    </header>
  );
}
