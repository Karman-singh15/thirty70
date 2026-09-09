import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getRoomByInviteCode, joinRoom } from "@/lib/rooms";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const inviteCode = (body.inviteCode as string)?.trim();

  if (!inviteCode) {
    return NextResponse.json({ error: "Invite code required" }, { status: 400 });
  }

  const found = await getRoomByInviteCode(inviteCode);
  if (!found) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  }

  try {
    const room = await joinRoom(
      found.id,
      userId,
      user.fullName ?? user.username ?? "Anonymous",
      user.imageUrl ?? ""
    );

    // joinRoom returns null when the room went away between the lookup above
    // and the insert — rare, but a 200 carrying `{ room: null }` is worse than
    // rare: the client reads room.id straight off it and throws.
    if (!room) {
      return NextResponse.json({ error: "That room no longer exists" }, { status: 404 });
    }

    return NextResponse.json({ room });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
