import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { setRoomProblem } from "@/lib/rooms";
import { parseProblemUpdate } from "@/lib/roomProblemPayload";

// Picking the room's problem. The room's state used to be read back from here
// too (a GET, polled every 700ms) — that's now pushed over /stream instead —
// and there used to be a whole-document code save alongside it, which the
// live editor path (/api/rooms/[id]/editor) replaced. Only the problem
// mutation is left; the route name is a leftover from when it did more.

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

  // Validated before anything is written — see lib/roomProblemPayload.ts.
  const update = parseProblemUpdate(body);
  if (!update) {
    return NextResponse.json({ error: "Invalid problem selection" }, { status: 400 });
  }

  const room = await setRoomProblem(
    id,
    userId,
    update.problem,
    update.starterCode,
    update.starterLanguage
  );
  if (!room) {
    return NextResponse.json({ error: "Room not found or not the host" }, { status: 403 });
  }
  return NextResponse.json({ room });
}
