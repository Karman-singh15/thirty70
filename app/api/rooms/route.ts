import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createRoom, getRoomsForUser } from "@/lib/rooms";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rooms = getRoomsForUser(userId).map((r) => ({
    id: r.id,
    name: r.name,
    ownerName: r.ownerName,
    participantCount: r.participants.length,
    problem: r.problem,
    createdAt: r.createdAt,
  }));

  return NextResponse.json({ rooms });
}

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
  const name = (body.name as string)?.trim() || "Untitled Room";

  const room = createRoom(
    name,
    userId,
    user.fullName ?? user.username ?? "Anonymous",
    user.imageUrl ?? ""
  );

  return NextResponse.json({ room });
}
