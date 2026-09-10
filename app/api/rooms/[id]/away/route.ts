import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { broadcastRoomUpdate, isRoomMember } from "@/lib/rooms";
import { removePresence } from "@/lib/roomState";

// "My tab is going away" — which is not the same as "I am leaving this room",
// and used to be treated as if it were.
//
// The unload beacon in hooks/useRoom.ts used to POST to /leave, and `pagehide`
// fires on a reload just as it does on a close. So refreshing a room page
// resigned your membership; if you were the only one in there, leaveRoom went
// on to delete the room, and the reloaded page landed on a room that no longer
// existed. Reloading a room you were sitting in alone destroyed it.
//
// Dropping presence gets what the beacon was actually for — everyone else sees
// you go dark immediately, rather than waiting out the presence window — while
// leaving the membership, the turn queue and the room itself alone. A tab that
// genuinely closed is then cleaned up by the machinery that already exists for
// it: presence times out, and getRoom's empty-room grace disbands the room if
// nobody comes back. A reload just re-announces itself a second later.
//
// The Leave button still means Leave: it posts to /leave, unchanged.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Someone who isn't in this room has no presence to drop.
  if (!(await isRoomMember(id, userId))) {
    return NextResponse.json({ ok: true });
  }

  await removePresence(id, userId);
  // Tell the room, so the roster dims this person now rather than in 50s —
  // which is the whole reason the beacon exists.
  await broadcastRoomUpdate(id);

  return NextResponse.json({ ok: true });
}
