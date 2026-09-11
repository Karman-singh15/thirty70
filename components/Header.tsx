"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-line bg-canvas px-6 py-3">
      <Link href="/dashboard" className="flex items-center gap-2 text-ink">
        <Logo size={28} animated />
        <span className="text-lg font-semibold tracking-tight">LeetDuel</span>
      </Link>
      <UserButton />
    </header>
  );
}
