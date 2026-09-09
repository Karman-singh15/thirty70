import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isRoomMemberCached, settleExpiredTurn } from "@/lib/rooms";

// The clock running out is the one state change nobody asks for, and with
// polling gone there was nothing left watching for it: the rotation only
// moved when some unrelated read happened to land, in practice the 20s SSE
// heartbeat — so a turn could sit visibly at 0:00 for up to twenty seconds
// before anything happened.
//
// Every client already counts the same deadline down locally, so the first
// one to reach zero says so here. Being hit by every client in the room at
// once is fine and expected: settleExpiredTurn claims the turn number
// atomically, so exactly one call rotates and the rest are no-ops. Being hit
// early, late, or by a client with a skewed clock is fine too — the deadline
// is re-checked against the server's own clock, and a turn with time left on
// it is simply left alone.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await isRoomMemberCached(id, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  // The rotation reaches everyone over the room channel, so there's nothing
  // to hand back beyond whether this caller is the one who moved it.
  const settled = await settleExpiredTurn(id);
  return NextResponse.json({ ok: true, settled });
}
