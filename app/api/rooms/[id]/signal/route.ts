import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isRoomMemberCached } from "@/lib/rooms";
import { publishSignal, queueSignal, type SignalPayload } from "@/lib/roomState";

// WebRTC signaling relay. Peers exchange SDP offers/answers and ICE candidates
// through here to set up a direct connection; once that's up, the actual audio
// and video flow browser-to-browser and never come back through this server.
//
// Delivery is live, over the same SSE connection as everything else (see
// publishSignal) — there's no GET here to poll. The membership check below
// still reads the cached room meta rather than Postgres, since this still
// runs on every keystroke of a handshake (a burst of ICE candidates).

const VALID_KINDS = new Set(["hello", "offer", "answer", "ice"]);

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
  if (!(await isRoomMemberCached(id, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const body = await req.json();
  const incoming: unknown = body.messages;
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }

  const messages = incoming
    .filter(
      (m): m is { to: string; session: string; kind: SignalPayload["kind"]; data: unknown } =>
        !!m &&
        typeof m.to === "string" &&
        m.to !== userId &&
        typeof m.session === "string" &&
        typeof m.kind === "string" &&
        VALID_KINDS.has(m.kind)
    )
    .map((m) => ({
      to: m.to,
      payload: { from: userId, session: m.session, kind: m.kind, data: m.data },
    }));

  await Promise.all(
    messages.map(({ to, payload }) =>
      Promise.all([publishSignal(id, to, payload), queueSignal(id, to, payload)])
    )
  );

  return NextResponse.json({ ok: true, delivered: messages.length });
}
