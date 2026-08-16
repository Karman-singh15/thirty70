import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getRoom, setRoomProblem, updateRoomCode } from "@/lib/rooms";
import { getMediaState, getOnlineUserIds, touchPresence } from "@/lib/roomState";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  // All four go out together. touchPresence used to be awaited after the rest
  // had come back, which added a whole round trip to a request that runs
  // several times a second; the only cost of racing it is that the caller's
  // own presence can be one poll behind, which it already was.
  const [room, onlineUserIds, media] = await Promise.all([
    getRoom(id),
    getOnlineUserIds(id),
    getMediaState(id),
    touchPresence(id, userId),
  ]);

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (!room.participants.some((p) => p.userId === userId)) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  return NextResponse.json({
    code: room.code,
    language: room.language,
    problem: room.problem,
    participants: room.participants,
    updatedAt: room.updatedAt,
    turnDurationSeconds: room.turnDurationSeconds,
    turnOrder: room.turnOrder,
    currentTurnUserId: room.currentTurnUserId,
    turnNumber: room.turnNumber,
    turnEndsAt: room.turnEndsAt,
    turnPausedRemainingMs: room.turnPausedRemainingMs,
    onlineUserIds,
    micOn: media.micOn,
    cameraOn: media.cameraOn,
  });
}

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
