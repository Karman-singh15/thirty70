import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getRoomMeta } from "@/lib/rooms";
import { publishSignal, queueSignal, type SignalPayload } from "@/lib/roomState";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

// WebRTC signaling relay. Peers exchange SDP offers/answers and ICE candidates
// through here to set up a direct connection; once that's up, the actual audio
// and video flow browser-to-browser and never come back through this server.
//
// Delivery is live, over the same SSE connection as everything else (see
// publishSignal) — there's no GET here to poll. The membership check below
// still reads the cached room meta rather than Postgres, since this still
// runs on every keystroke of a handshake (a burst of ICE candidates).

const VALID_KINDS = new Set(["hello", "offer", "answer", "ice"]);

// A handshake is a dozen ICE candidates, not a thousand. Capping the batch
// stops one request from queueing unbounded work, and the per-message cap
// keeps an SDP blob (a few KB in practice) from being used as storage.
const MAX_MESSAGES = 64;
const MAX_DATA_CHARS = 16_000;

// A handshake with three peers trickles perhaps 50 candidates, and a reconnect
// repeats that. Deliberately far above normal use: this bounds a runaway loop,
// it isn't meant to shape ordinary signalling.
const BATCHES_PER_MINUTE = 240;

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
  // The full meta rather than a boolean: the recipient of every message has to
  // be checked against this same list below, and it's one cached read either
  // way.
  const meta = await getRoomMeta(id);
  if (!meta || !meta.participants.some((p) => p.userId === userId)) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  const members = new Set(meta.participants.map((p) => p.userId));

  const limit = await rateLimit(`signal:${id}:${userId}`, BATCHES_PER_MINUTE, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const body = await req.json();
  const incoming: unknown = body.messages;
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }
  if (incoming.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "too many messages" }, { status: 413 });
  }

  const messages = incoming
    .filter(
      (m): m is { to: string; session: string; kind: SignalPayload["kind"]; data: unknown } =>
        !!m &&
        typeof m.to === "string" &&
        m.to !== userId &&
        // Previously any string was accepted as a recipient. Delivery is
        // scoped to this room's channel so a non-member was never listening,
        // but queueSignal *persists* the message — so unchecked recipients let
        // a member fill Redis with signals addressed to people who will never
        // read them, and hand forged handshakes to anyone who later joins.
        members.has(m.to) &&
        typeof m.session === "string" &&
        typeof m.kind === "string" &&
        VALID_KINDS.has(m.kind) &&
        // `data` is SDP/ICE that reaches the peer's WebRTC APIs untouched.
        // Its shape is the browser's business, but its size is ours.
        JSON.stringify(m.data ?? null).length <= MAX_DATA_CHARS
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
