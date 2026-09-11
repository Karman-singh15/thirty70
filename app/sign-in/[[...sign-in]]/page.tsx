import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-canvas px-4 py-16">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-on-accent">
          L
        </span>
        <span className="text-lg font-semibold tracking-tight text-ink">
          LeetDuel
        </span>
      </Link>
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#1b1b19",
            colorBackground: "#18181b",
            colorForeground: "#fafafa",
            colorMutedForeground: "#a1a1aa",
            borderRadius: "0.75rem",
          },
        }}
      />
    </div>
  );
}
