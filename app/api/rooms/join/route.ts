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

  const room = await joinRoom(
    found.id,
    userId,
    user.fullName ?? user.username ?? "Anonymous",
    user.imageUrl ?? ""
  );

  return NextResponse.json({ room });
}
