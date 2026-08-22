import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isRoomMemberCached } from "@/lib/rooms";
import { getLiveState, publishJudgeEvent, type JudgeBroadcast } from "@/lib/roomState";

// Broadcasts a Run/Submit's loading stage, result, or error to everyone in
// the room. The extension call itself only ever happens in the acting
// client's own browser (it's the only one with the LeetCode session) — this
// route exists purely to fan that client's local progress out to everyone
// else watching, over the same channel turn/presence updates already use.

const VALID_STATUSES = new Set(["loading", "result", "error"]);

function isJudgeBroadcast(input: unknown): input is JudgeBroadcast {
  if (!input || typeof input !== "object") return false;
  const { status, mode, userId, name } = input as Record<string, unknown>;
  return (
    VALID_STATUSES.has(status as string) &&
    (mode === "run" || mode === "submit") &&
    typeof userId === "string" &&
    typeof name === "string"
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  if (!isJudgeBroadcast(body?.judge) || body.judge.userId !== userId) {
    return NextResponse.json({ error: "Invalid judge payload" }, { status: 400 });
  }

  // Same gate as the editor's write path: whoever holds the turn, falling
  // back to plain membership before any turn has started.
  const live = await getLiveState(id);
  const allowed = live.currentTurnUserId
    ? live.currentTurnUserId === userId
    : await isRoomMemberCached(id, userId);
  if (!allowed) {
    return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  }

  await publishJudgeEvent(id, body.judge);
  return NextResponse.json({ ok: true });
}
