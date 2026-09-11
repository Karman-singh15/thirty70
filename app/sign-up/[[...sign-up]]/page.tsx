import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/Logo";

export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-canvas px-4 py-16">
      <Link href="/" className="flex items-center gap-2">
        <Logo size={28} animated />
        <span className="text-lg font-semibold tracking-tight text-ink">
          LeetDuel
        </span>
      </Link>
      <SignUp
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
