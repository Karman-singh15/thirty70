import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createRoom, getCurrentRoomForUser } from "@/lib/rooms";

// A user is in at most one room at a time, so this answers "which one" rather
// than handing back a list — see getCurrentRoomForUser. `null` means they're
// not in one.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const current = await getCurrentRoomForUser(userId);
  if (!current) return NextResponse.json({ room: null });

  return NextResponse.json({
    room: {
      id: current.id,
      name: current.name,
      ownerName: current.ownerName,
      participantCount: current.participants.length,
      problem: current.problem,
    },
  });
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

  const room = await createRoom(
    name,
    userId,
    user.fullName ?? user.username ?? "Anonymous",
    user.imageUrl ?? ""
  );

  return NextResponse.json({ room });
}
