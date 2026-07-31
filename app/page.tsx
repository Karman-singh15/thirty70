"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { Code2, Users, Search, Zap } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isSignedIn) {
      router.replace("/dashboard");
    }
  }, [isSignedIn, router]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Code2 className="h-7 w-7 text-emerald-400" />
          <span className="text-xl font-bold tracking-tight">Thirty70</span>
        </div>
        <div className="flex items-center gap-3">
          <SignInButton mode="modal">
            <button className="rounded-lg px-4 py-2 text-sm text-zinc-300 hover:text-white">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400">
              Get Started
            </button>
          </SignUpButton>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 pt-20 pb-32 text-center">
        <h1 className="text-5xl font-bold leading-tight tracking-tight">
          Solve LeetCode
          <br />
          <span className="text-emerald-400">with friends</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400">
          Create collaborative rooms, search any LeetCode problem, and code together
          in real-time — like a shared interview prep session.
        </p>

        <div className="mt-10 flex items-center justify-center gap-4">
          <SignUpButton mode="modal">
            <button className="rounded-xl bg-emerald-500 px-8 py-3 text-base font-semibold text-zinc-950 hover:bg-emerald-400">
              Start for free
            </button>
          </SignUpButton>
          <Link
            href="/sign-in"
            className="rounded-xl border border-zinc-700 px-8 py-3 text-base font-medium text-zinc-300 hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </div>

        <div className="mt-24 grid gap-6 sm:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Private Rooms",
              desc: "Create rooms and share invite links with your study group.",
            },
            {
              icon: Search,
              title: "LeetCode Search",
              desc: "Search and load any free LeetCode problem via GraphQL.",
            },
            {
              icon: Zap,
              title: "Live Collaboration",
              desc: "Code together in a shared editor that syncs in real-time.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-left"
            >
              <Icon className="h-6 w-6 text-emerald-400" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-zinc-400">{desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
