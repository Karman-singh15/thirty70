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

  const checkoutUrl = await createUpgradeCheckout(
    userId,
    email,
    user.fullName ?? user.username ?? "Anonymous"
  );

  return NextResponse.json({ checkoutUrl });
}
