import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { setRoomProblem, updateRoomCode } from "@/lib/rooms";

// Writes only. The room's state used to be read back from here too (a GET,
// polled every 700ms) — that's now pushed over /stream instead, so this
// route is left with just the two mutations that started life alongside it:
// picking a problem, and the legacy whole-document code save.

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

  if (body.problem) {
    const room = await setRoomProblem(
      id,
      userId,
      body.problem,
      typeof body.code === "string" ? body.code : "",
      body.language ?? "javascript"
    );
    if (!room) {
      return NextResponse.json({ error: "Room not found or not the host" }, { status: 403 });
    }
    return NextResponse.json({ room });
  }

  if (typeof body.code === "string") {
    const result = await updateRoomCode(id, body.code, body.language ?? "javascript", userId);
    if (result === "not_member") {
      return NextResponse.json({ error: "Not a member" }, { status: 404 });
    }
    if (result === "not_your_turn") {
      return NextResponse.json({ error: "Not your turn" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid update" }, { status: 400 });
}
