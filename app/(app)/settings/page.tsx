"use client";

import { Suspense } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { LogOut, SquareArrowOutUpRight } from "lucide-react";
import { PlanStatus } from "@/components/PlanStatus";
import { UsernameSetting } from "@/components/social/UsernameSetting";

export default function SettingsPage() {
  const { user, isLoaded } = useUser();
  const { openUserProfile, signOut } = useClerk();

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Settings
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Manage your account and subscription.
      </p>

      <section className="mt-9">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Account
        </h2>
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5">
          <div className="flex min-w-0 items-center gap-3">
            {isLoaded && user ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.imageUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-elevated" />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">
                {isLoaded ? user?.fullName ?? "Your account" : ""}
              </p>
              <p className="truncate text-sm text-muted">
                {isLoaded
                  ? user?.primaryEmailAddress?.emailAddress
                  : ""}
              </p>
            </div>
          </div>
          <button
            onClick={() => openUserProfile()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:bg-surface"
          >
            Manage
            <SquareArrowOutUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Username
        </h2>
        <UsernameSetting />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Subscription
        </h2>
        <Suspense
          fallback={
            <div className="h-[140px] animate-pulse rounded-2xl border border-line bg-surface" />
          }
        >
          <PlanStatus />
        </Suspense>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Session
        </h2>
        <button
          onClick={() => signOut({ redirectUrl: "/" })}
          className="flex items-center gap-2 rounded-lg border border-line px-3.5 py-2.5 text-sm font-medium text-muted transition hover:border-danger-line hover:text-danger"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </section>
    </div>
  );
}
