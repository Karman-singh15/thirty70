"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Swords, Users, Settings, Crown, Loader2 } from "lucide-react";
import { useBillingPlan } from "@/hooks/useBillingPlan";

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
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 px-5 py-5 text-zinc-100"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-400 text-sm font-bold text-zinc-950">
          7
        </span>
        <span className="text-base font-semibold tracking-tight">
          thirty70
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
                  ? "bg-zinc-900 text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-200"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${active ? "text-emerald-400" : ""}`}
              />
              {label}
              {href === "/competitive" && (
                <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                  soon
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-zinc-900 p-3">
        {plan !== "pro" && (
          <button
            onClick={upgrade}
            disabled={upgrading || plan === null}
            className="mb-2 flex w-full items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-wait disabled:opacity-60"
          >
            {upgrading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Crown className="h-3.5 w-3.5" />
            )}
            {upgrading ? "Redirecting…" : "Upgrade to Pro"}
          </button>
        )}

        <div className="flex items-center gap-2 rounded-lg px-1 py-1">
          {isLoaded && user ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-zinc-800" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-200">
              {isLoaded ? user?.fullName ?? user?.username ?? "Account" : ""}
            </p>
            {plan === "pro" ? (
              <p className="flex items-center gap-1 text-[11px] text-amber-400">
                <Crown className="h-3 w-3" /> Pro
              </p>
            ) : (
              <p className="text-[11px] text-zinc-500">Free plan</p>
            )}
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-zinc-900 ${
              pathname === "/settings" ? "text-emerald-400" : "text-zinc-500"
            }`}
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
