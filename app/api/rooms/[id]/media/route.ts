import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/rooms";
import { setMediaState } from "@/lib/roomState";

// Broadcasts whether the caller's mic/camera is on to other participants.
// Doesn't touch the media stream itself — see MediaControls for that.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const room = await getRoom(id);
  if (!room || !room.participants.some((p) => p.userId === userId)) {
    return NextResponse.json({ error: "Not a member" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Promise<void>[] = [];
  if (typeof body.mic === "boolean") {
    updates.push(setMediaState(id, userId, "mic", body.mic));
  }
  if (typeof body.camera === "boolean") {
    updates.push(setMediaState(id, userId, "camera", body.camera));
  }
  await Promise.all(updates);

  return NextResponse.json({ ok: true });
}
