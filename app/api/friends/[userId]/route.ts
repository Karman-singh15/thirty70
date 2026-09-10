import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { removeFriend } from "@/lib/social";
import { publishUserEvent } from "@/lib/userState";

// Ends a friendship. Either side can do it, and it's symmetric — there's one
// row, so there's no version of this where one of them still has the other.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId: otherId } = await params;

  const changed = await removeFriend(userId, otherId);
  if (!changed) {
    return NextResponse.json({ error: "You aren't friends" }, { status: 404 });
  }

  await publishUserEvent(otherId, { type: "friends" });
  await publishUserEvent(userId, { type: "friends" });

  return NextResponse.json({ ok: true });
}
