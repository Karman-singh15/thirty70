"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { ArrowRight, GitBranch, Swords, Timer } from "lucide-react";
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
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-400 text-sm font-bold text-zinc-950">
            7
          </span>
          <span className="text-lg font-semibold tracking-tight">thirty70</span>
        </div>
        <div className="flex items-center gap-2">
          <SignInButton mode="modal">
            <button className="rounded-lg px-3.5 py-2 text-sm text-zinc-400 transition hover:text-zinc-100">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="rounded-lg bg-zinc-100 px-3.5 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white">
              Sign up
            </button>
          </SignUpButton>
        </div>
      </nav>

      <main className="relative flex-1 overflow-hidden">
        <div className="grain-overlay" />
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(52,211,153,0.35), transparent)",
          }}
        />

        <section className="relative mx-auto grid max-w-6xl gap-16 px-6 pt-16 pb-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-24">
          <div className="animate-fade-in-up">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-medium text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              now with head-to-head rooms
            </span>
            <h1
              className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
              style={{ textWrap: "balance" }}
            >
              Grind LeetCode
              <br />
              in the same room.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-zinc-400">
              Open a shared editor, pull in any problem, and work it out loud
              with someone else watching the cursor move — not just the
              solution.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <SignUpButton mode="modal">
                <button className="group flex items-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 active:scale-[0.98]">
                  Start a room
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </button>
              </SignUpButton>
              <Link
                href="/sign-in"
                className="rounded-xl border border-zinc-800 px-6 py-3 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                I have an account
              </Link>
            </div>
          </div>

          <div className="animate-fade-in-up [animation-delay:120ms]">
            <RoomPreview />
          </div>
        </section>

        <section className="relative mx-auto max-w-6xl border-t border-zinc-900 px-6 py-20">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <FeatureRow
              icon={GitBranch}
              title="One editor, synced cursors"
              desc="Every keystroke, run, and submission mirrors instantly across the room — Monaco underneath, so it feels like your own setup."
            />
            <FeatureRow
              icon={Timer}
              title="Turns, not chaos"
              desc="A turn timer hands the keyboard around the room automatically, so pairing sessions don't turn into two people typing over each other."
            />
          </div>
        </section>

        <section className="relative mx-auto max-w-6xl px-6 pb-28">
          <div className="mb-10 flex items-end justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              Two ways to show up
            </h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8">
              <span className="text-xs font-medium uppercase tracking-wider text-emerald-400">
                Rooms
              </span>
              <h3 className="mt-3 text-xl font-semibold text-zinc-100">
                Practice together
              </h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
                Invite a friend, pick a problem, and talk through the
                approach in a shared editor with voice and video. No
                scoreboard — just two people working the same problem.
              </p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8">
              <span className="absolute right-5 top-5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                Coming soon
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-amber-400">
                Competitive
              </span>
              <h3 className="mt-3 flex items-center gap-2 text-xl font-semibold text-zinc-100">
                <Swords className="h-4.5 w-4.5 text-zinc-500" />
                Race the clock, head to head
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Same problem, separate editors, one timer. First correct
                submission wins.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-900 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-zinc-500 sm:flex-row">
          <span>© 2026 thirty70</span>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-zinc-300">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-zinc-300">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof GitBranch;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
        <Icon className="h-4.5 w-4.5 text-emerald-400" />
      </div>
      <div>
        <h3 className="font-medium text-zinc-100">{title}</h3>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-400">
          {desc}
        </p>
      </div>
    </div>
  );
}

function RoomPreview() {
  return (
    <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-2xl shadow-emerald-500/5">
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="ml-2 text-xs text-zinc-500">two-sum-again</span>
      </div>
      <div className="grid grid-cols-[1fr_1.3fr]">
        <div className="border-r border-zinc-800 p-4">
          <span className="text-[11px] font-medium text-emerald-400">
            Easy
          </span>
          <p className="mt-1.5 text-sm font-medium text-zinc-200">Two Sum</p>
          <div className="mt-4 space-y-1.5">
            <div className="h-2 w-full rounded bg-zinc-800" />
            <div className="h-2 w-5/6 rounded bg-zinc-800" />
            <div className="h-2 w-4/6 rounded bg-zinc-800" />
          </div>
        </div>
        <div className="p-4 font-mono text-[11px] leading-relaxed text-zinc-500">
          <p>
            <span className="text-zinc-600">1</span>{" "}
            <span className="text-purple-400">function</span>{" "}
            <span className="text-blue-400">twoSum</span>(nums, target) {"{"}
          </p>
          <p className="pl-4">
            <span className="text-zinc-600">2</span>{" "}
            <span className="text-purple-400">const</span> seen ={" "}
            <span className="text-purple-400">new</span> Map();
          </p>
          <p className="relative pl-4">
            <span className="text-zinc-600">3</span>{" "}
            <span className="text-purple-400">for</span> (
            <span className="text-purple-400">let</span> i = 0; ...
            <span className="collab-caret ml-1 inline-block h-3 align-middle" />
          </p>
          <p className="pl-4 text-zinc-700">
            <span className="text-zinc-600">4</span> ...
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
        <div className="flex -space-x-2">
          <span className="h-6 w-6 rounded-full border-2 border-zinc-900 bg-emerald-500" />
          <span className="h-6 w-6 rounded-full border-2 border-zinc-900 bg-blue-500" />
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Timer className="h-3 w-3" />
          0:42 left on your turn
        </span>
      </div>
    </div>
  );
}
