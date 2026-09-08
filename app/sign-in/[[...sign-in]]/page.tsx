import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 px-4 py-16">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-400 text-sm font-bold text-zinc-950">
          7
        </span>
        <span className="text-lg font-semibold tracking-tight text-zinc-100">
          thirty70
        </span>
      </Link>
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#34d399",
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
