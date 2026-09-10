import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { ensureProfile, getProfile, setUsername } from "@/lib/social";
import { getFriendIds } from "@/lib/social";
import { publishUserEvents } from "@/lib/userState";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

// The signed-in user's own profile. Every authenticated page loads this once
// on mount (see hooks/useSocial.tsx), which makes it the natural place to
// guarantee the users row exists — rooms used to be the only thing that
// created one, so someone who had signed up but never opened a room was
// invisible to a friend searching for them.

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read before write: this runs on every app load, and the overwhelming
  // majority of them are for a row that already exists and hasn't changed.
  // The upsert is reserved for the first load of a new account.
  const existing = await getProfile(userId);
  if (existing) return NextResponse.json({ profile: existing });

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await ensureProfile(
    userId,
    user.fullName ?? user.username ?? "Anonymous",
    user.imageUrl ?? ""
  );

  return NextResponse.json({ profile });
}

// Claims or changes a username. Used both by the dialog that greets a new
// account and by the Username section of /settings — one endpoint, because
// the two are the same operation with different surroundings.
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Loose enough never to be felt by someone picking a handle, tight enough
  // that the endpoint can't be used to enumerate which usernames are free.
  const limit = await rateLimit(`username:${userId}`, 10, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const body = await req.json().catch(() => ({}));
  const requested = typeof body.username === "string" ? body.username : "";

  // The row has to exist before it can be updated, and this can be the very
  // first thing a new account does.
  const existing = await getProfile(userId);
  if (!existing) {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureProfile(
      userId,
      user.fullName ?? user.username ?? "Anonymous",
      user.imageUrl ?? ""
    );
  }

  const result = await setUsername(userId, requested);

  if (!result.ok) {
    // 409 for a name someone else holds, 400 for one that breaks the rules —
    // the client shows both under the input, but they're different answers to
    // "why not", and only one of them is fixed by trying again later.
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: result.reason === "taken" ? 409 : 400 }
    );
  }

  const profile = await getProfile(userId);

  // Friends see the handle on every card that names this person, so a change
  // has to reach the lists they're already looking at.
  if (existing?.username && existing.username !== result.username) {
    await publishUserEvents(await getFriendIds(userId), { type: "friends" });
  }

  return NextResponse.json({ profile });
}
