import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Privacy — thirty70",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-canvas px-6 py-16 text-ink">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink-soft"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back home
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-2 text-sm text-muted">Last updated September 2026</p>

        <div className="mt-10 space-y-8 font-sans text-sm leading-relaxed text-muted">
          <section>
            <h2 className="font-mono text-base font-medium text-ink">What we store</h2>
            <p className="mt-2">
              Your account (name, email, and profile image) comes from Clerk,
              our authentication provider. Rooms you create — their name,
              invite code, and the problem attached to them — are stored so
              you and the people you invite can return to them.
            </p>
          </section>
          <section>
            <h2 className="font-mono text-base font-medium text-ink">
              Code you write
            </h2>
            <p className="mt-2">
              Code typed into a room is synced live to the other participants
              in that room so everyone sees the same editor state. It is not
              used to train any model and is not shared outside the room.
            </p>
          </section>
          <section>
            <h2 className="font-mono text-base font-medium text-ink">Billing</h2>
            <p className="mt-2">
              Payments are handled by Dodo Payments. We store your plan
              status and subscription id — never your card details.
            </p>
          </section>
          <section>
            <h2 className="font-mono text-base font-medium text-ink">Questions</h2>
            <p className="mt-2">
              Reach out to the address on your invoice or Dodo receipt if you
              want your data removed.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
