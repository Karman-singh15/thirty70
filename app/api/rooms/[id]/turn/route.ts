import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { passTurn, setTurnDuration } from "@/lib/rooms";

// Current turn holder passes to the next player.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const room = await passTurn(id, userId);
  if (!room) {
    return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  }

  return NextResponse.json({ room });
}

// Room owner sets how long each turn lasts.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const seconds = Number(body.turnDurationSeconds);

  if (!Number.isFinite(seconds)) {
    return NextResponse.json({ error: "turnDurationSeconds required" }, { status: 400 });
  }

  try {
    const room = await setTurnDuration(id, userId, seconds);
    if (!room) {
      return NextResponse.json({ error: "Room not found or not the owner" }, { status: 403 });
    }
    return NextResponse.json({ room });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
