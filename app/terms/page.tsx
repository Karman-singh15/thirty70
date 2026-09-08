import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Terms — thirty70",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back home
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Terms</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated September 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-400">
          <section>
            <h2 className="text-base font-medium text-zinc-200">The service</h2>
            <p className="mt-2">
              thirty70 lets you create shared rooms to work through LeetCode
              problems with other people in real time. Free rooms hold up to
              4 participants; Pro rooms hold up to 8.
            </p>
          </section>
          <section>
            <h2 className="text-base font-medium text-zinc-200">Problem content</h2>
            <p className="mt-2">
              Problem statements are fetched from LeetCode&apos;s public API on
              your behalf. We don&apos;t host or claim ownership of that content.
              Premium-only LeetCode problems stay unavailable here.
            </p>
          </section>
          <section>
            <h2 className="text-base font-medium text-zinc-200">Subscriptions</h2>
            <p className="mt-2">
              Pro is billed on a recurring basis through Dodo Payments. You
              can cancel from your billing portal at any time; access
              continues until the end of the paid period.
            </p>
          </section>
          <section>
            <h2 className="text-base font-medium text-zinc-200">Fair use</h2>
            <p className="mt-2">
              Don&apos;t use rooms to abuse the LeetCode API, harass other
              participants, or share invite links publicly to bypass room
              limits.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
