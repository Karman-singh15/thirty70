"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Settings, Swords, Users } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AddFriendButton } from "@/components/social/AddFriendButton";

// The sidebar is a 240px fixed rail. On a 390px phone that left ~120px for the
// page, which is what turned every heading into one word per line. Below `md`
// the rail is hidden and this bar stands in for it.
//
// A bar rather than a hamburger drawer on purpose: there are exactly two
// destinations, so a drawer would add an open/close state and an overlay to
// hide two links behind a tap. Everything the sidebar offers is here except
// the plan row, which lives on /settings anyway.

const NAV_ITEMS = [
  { href: "/dashboard", label: "Room", icon: Users },
  { href: "/competitive", label: "Competitive", icon: Swords },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();

  return (
    <header className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2 md:hidden">
      <Link href="/dashboard" className="flex shrink-0 items-center gap-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-on-accent">
          7
        </span>
        <span className="text-sm font-semibold tracking-tight text-ink">
          thirty70
        </span>
      </Link>

      <nav className="ml-1 flex min-w-0 items-center gap-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                active
                  ? "bg-surface text-ink"
                  : "text-muted hover:bg-surface hover:text-ink-soft"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? "text-accent" : ""}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Icon-only here — the rail's labelled button doesn't fit, but the
            pending-request badge is the part that has to survive. */}
        <AddFriendButton compact />
        <ThemeToggle />
        <Link
          href="/settings"
          aria-label="Settings"
          className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface ${
            pathname === "/settings" ? "text-accent" : "text-muted"
          }`}
        >
          {isLoaded && user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt=""
              className="h-6 w-6 rounded-md object-cover"
            />
          ) : (
            <Settings className="h-4 w-4" />
          )}
        </Link>
      </div>
    </header>
  );
}
