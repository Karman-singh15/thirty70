import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { listRoomInvites, publishUserEvent, removeRoomInvite } from "@/lib/userState";

// Room invites waiting for this user. Read once on mount; after that they
// arrive over /api/me/stream, so this is the cold-start path rather than the
// steady state.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ invites: await listRoomInvites(userId) });
}

// Dismisses one — declining, or clearing it after joining.
//
// The sender is told the invite was answered, but never *how*. They need it to
// re-arm their Invite button, which otherwise sat on "Sent" forever and gave
// them no way to ask again after a decline. "They declined you" stays
// unpublished: the room already shows who actually turned up.
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";

  if (!inviteId) {
    return NextResponse.json({ error: "inviteId required" }, { status: 400 });
  }

  const removed = await removeRoomInvite(userId, inviteId);

  // Null when there was nothing to remove — a double-click, or a card left
  // over from an invite that already expired. Nobody to tell in that case.
  if (removed) {
    await publishUserEvent(removed.from.userId, {
      type: "invite_resolved",
      roomId: removed.roomId,
      userId,
    });
  }

  return NextResponse.json({ ok: true });
}
