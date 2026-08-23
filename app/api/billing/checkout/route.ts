import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createUpgradeCheckout } from "@/lib/billing";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!email) {
    return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });
  }

  try {
    const checkoutUrl = await createUpgradeCheckout(
      userId,
      email,
      user.fullName ?? user.username ?? "Anonymous"
    );
    return NextResponse.json({ checkoutUrl });
  } catch (err) {
    // Otherwise a Dodo API error (bad product id, unverified live account,
    // network failure, ...) falls through to Next's default HTML error
    // page instead of JSON, which breaks the client's res.json() call.
    console.error("Dodo checkout session creation failed:", err);
    const message = err instanceof Error ? err.message : "Could not start checkout";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
