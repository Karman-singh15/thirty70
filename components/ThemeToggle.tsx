"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";

// A segmented control rather than the usual sun/moon switch. A two-state
// switch can't represent "follow my system", so it has to either drop that
// option or hide it — and then a user who never chose anything is silently
// pinned to whatever the switch happened to start on.
const OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
              selected
                ? "bg-canvas text-ink shadow-sm"
                : "text-faint hover:text-muted"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
