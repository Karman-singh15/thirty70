"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Swords, Users, Settings, Crown, Loader2 } from "lucide-react";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AddFriendButton } from "@/components/social/AddFriendButton";

const NAV_ITEMS = [
  // Singular: a user is in at most one room at a time.
  { href: "/dashboard", label: "Room", icon: Users },
  { href: "/competitive", label: "Competitive", icon: Swords },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const { plan, upgrading, upgrade } = useBillingPlan();

  return (
    // Hidden below `md`, where MobileNav stands in for it: this rail is a
    // fixed 240px, which on a 390px screen left the page barely a third of
    // the width.
    <aside className="hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-canvas md:flex">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 px-5 py-5 text-ink"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-on-accent">
          L
        </span>
        <span className="text-base font-semibold tracking-tight">
          LeetDuel
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-surface text-ink"
                  : "text-muted hover:bg-surface hover:text-ink"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${active ? "text-accent" : ""}`}
              />
              {label}
              {href === "/competitive" && (
                <span className="ml-auto rounded-full border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">
                  soon
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line p-3">
        {/* Above the profile row, and above the upgrade prompt: this is the
            only place an incoming friend request is visible from every page,
            so it shouldn't sit below a button that disappears once you pay. */}
        <div className="mb-2">
          <AddFriendButton />
        </div>

        {plan !== "pro" && (
          <button
            onClick={upgrade}
            disabled={upgrading || plan === null}
            className="mb-2 flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft transition hover:border-warn-line hover:text-warn disabled:cursor-wait disabled:opacity-60"
          >
            {upgrading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Crown className="h-3.5 w-3.5" />
            )}
            {upgrading ? "Redirecting…" : "Upgrade to Pro"}
          </button>
        )}

        <div className="mb-2 flex justify-center">
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-2 rounded-lg px-1 py-1">
          {isLoaded && user ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-elevated" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {isLoaded ? user?.fullName ?? user?.username ?? "Account" : ""}
            </p>
            {plan === "pro" ? (
              <p className="flex items-center gap-1 text-[11px] text-warn">
                <Crown className="h-3 w-3" /> Pro
              </p>
            ) : (
              <p className="text-[11px] text-muted">Free plan</p>
            )}
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-surface ${
              pathname === "/settings" ? "text-accent" : "text-muted"
            }`}
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
