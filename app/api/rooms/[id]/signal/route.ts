import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isRoomMember } from "@/lib/rooms";
import { drainSignals, pushSignals, type SignalMessage } from "@/lib/roomState";

// WebRTC signaling relay. Peers exchange SDP offers/answers and ICE candidates
// through here to set up a direct connection; once that's up, the actual audio
// and video flow browser-to-browser and never come back through this server.

const VALID_TYPES = new Set(["hello", "offer", "answer", "ice"]);

// Drain everything addressed to me since my last poll.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await isRoomMember(id, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  return NextResponse.json({ signals: await drainSignals(id, userId) });
}

// Send a batch of messages to other peers. Batched because ICE candidates
// trickle out a dozen at a time and shouldn't be a dozen separate requests.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await isRoomMember(id, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const body = await req.json();
  const incoming: unknown = body.messages;
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }

  const messages = incoming
    .filter(
      (m): m is { to: string; session: string; type: SignalMessage["type"]; data: unknown } =>
        !!m &&
        typeof m.to === "string" &&
        m.to !== userId &&
        typeof m.session === "string" &&
        typeof m.type === "string" &&
        VALID_TYPES.has(m.type)
    )
    .map((m) => ({ to: m.to, from: userId, session: m.session, type: m.type, data: m.data }));

  await pushSignals(id, messages);
  return NextResponse.json({ ok: true, delivered: messages.length });
}
