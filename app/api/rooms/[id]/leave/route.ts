import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { leaveRoom } from "@/lib/rooms";

// Voluntary exit. Marks the caller as left, drops them from presence and the
// turn queue, and hands off the turn if they were currently holding it.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await leaveRoom(id, userId);

  return NextResponse.json({ ok: true });
}
