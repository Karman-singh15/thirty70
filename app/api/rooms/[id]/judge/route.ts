import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isRoomMemberCached, recordSubmission, settleExpiredTurn } from "@/lib/rooms";
import { getLiveState, isTurnExpired, publishJudgeEvent } from "@/lib/roomState";
import { parseJudgeBroadcast } from "@/lib/judgePayload";

// Broadcasts a Run/Submit's loading stage, result, or error to everyone in
// the room. The extension call itself only ever happens in the acting
// client's own browser (it's the only one with the LeetCode session) — this
// route exists purely to fan that client's local progress out to everyone
// else watching, over the same channel turn/presence updates already use.
//
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
  const judge = parseJudgeBroadcast(body?.judge, userId);
  if (!judge) {
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

  // Same clock gate as the editor's write path — a run started after the
  // deadline isn't this player's to broadcast.
  if (isTurnExpired(live)) {
    await settleExpiredTurn(id);
    return NextResponse.json({ error: "Your turn ended" }, { status: 403 });
  }

  // A submit verdict is the only real signal the server ever gets about how a
  // session is going — the extension runs in the submitting player's browser,
  // so nothing else here can observe it. File it before fanning it out.
  if (judge.status === "result" && judge.result.mode === "submit") {
    await recordSubmission(id, judge.result.accepted);
  }

  await publishJudgeEvent(id, judge);
  return NextResponse.json({ ok: true });
}
