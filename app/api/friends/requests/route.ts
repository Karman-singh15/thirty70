import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  cancelFriendRequest,
  respondToFriendRequest,
  sendFriendRequest,
} from "@/lib/social";
import { publishUserEvent } from "@/lib/userState";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

// The three things that happen to a friend request: it's sent, it's answered,
// or it's withdrawn. One file, because they're one row's lifecycle — and
// every one of them ends the same way, by nudging both sides' open tabs so
// neither has to reload to see it.

// Sends a request to a username.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`friend-request:${userId}`, 20, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username : "";

  if (!username.trim()) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }

  const result = await sendFriendRequest(userId, username);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: result.reason === "not_found" ? 404 : 409 }
    );
  }

  // Both sides: the receiver has a new request (or a new friend), and the
  // sender may have this open in another tab.
  await publishUserEvent(result.target.userId, { type: "friends" });
  await publishUserEvent(userId, { type: "friends" });

  return NextResponse.json({ outcome: result.outcome, user: result.target });
}

// Accepts or declines a request sent *to* this user.
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requesterId = typeof body.userId === "string" ? body.userId : "";
  const action = body.action === "accept" ? "accept" : "decline";

  if (!requesterId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const changed = await respondToFriendRequest(userId, requesterId, action === "accept");

  // Nothing pending from that person — they withdrew it, or this is a second
  // click on a button that already worked. Not an error worth a red banner.
  if (!changed) {
    return NextResponse.json({ error: "That request is no longer open" }, { status: 404 });
  }

  await publishUserEvent(requesterId, { type: "friends" });
  await publishUserEvent(userId, { type: "friends" });

  return NextResponse.json({ ok: true, action });
}

// Withdraws a request this user sent.
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const addresseeId = typeof body.userId === "string" ? body.userId : "";

  if (!addresseeId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const changed = await cancelFriendRequest(userId, addresseeId);
  if (!changed) {
    return NextResponse.json({ error: "That request is no longer open" }, { status: 404 });
  }

  await publishUserEvent(addresseeId, { type: "friends" });
  await publishUserEvent(userId, { type: "friends" });

  return NextResponse.json({ ok: true });
}
