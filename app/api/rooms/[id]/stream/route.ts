import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { broadcastRoomUpdate, getRoomSnapshot, isRoomMember } from "@/lib/rooms";
import {
  getLiveState,
  subscribeRoomChannels,
  touchPresence,
  type EditorEvent,
  type RoomEvent,
} from "@/lib/roomState";

// Server-sent events carrying everything the room needs live: the shared
// editor's document (its own channel) and turn/participant/presence/media
// state (a second channel, multiplexed onto this same connection and this
// same Redis subscriber — see subscribeRoomChannels). This is what replaced
// the old 700ms /sync poll: state reaches everyone in roughly the time of one
// Redis publish instead of waiting out a poll interval, and Redis only gets
// touched when something actually changes instead of on every tick.
//
// This is also what drives presence now. There's no more per-poll heartbeat
// write — instead, this route's own keep-alive ping doubles as the presence
// refresh (see HEARTBEAT_MS), and PRESENCE_WINDOW_MS in roomState.ts is sized
// to tolerate one missed ping. Deliberately NOT marked offline the instant
// this connection drops: a flaky reconnect (EventSource retries on its own)
// would otherwise flash someone offline and back online for everyone else,
// which is worse than the alternative of "closed the tab" taking up to one
// presence window to be noticed. The explicit Leave button already handles
// the case that actually needs to be instant.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 20_000;

export async function GET(
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between our check and this write.
          cleanup();
        }
      };
      const writeEvent = (event: EditorEvent | RoomEvent) =>
        write(`data: ${JSON.stringify(event)}\n\n`);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      req.signal.addEventListener("abort", cleanup);
      if (req.signal.aborted) {
        cleanup();
        return;
      }

      // Connecting counts as presence — refresh it before anything else, so
      // the snapshot sent below (and the broadcast to everyone else) already
      // reflects this client as online.
      await touchPresence(id, userId);

      // Open with the current document and the current room state, so a
      // client that just connected — or reconnected after a drop — is fully
      // in sync with no separate fetch and no window of stale data.
      const live = await getLiveState(id);
      writeEvent({ type: "doc", version: live.docVersion, code: live.code, language: live.language });

      const snapshot = await getRoomSnapshot(id);
      if (snapshot) writeEvent({ type: "room", room: snapshot });

      unsubscribe = subscribeRoomChannels(id, {
        onEditorEvent: (raw) => write(`data: ${raw}\n\n`),
        onRoomEvent: (raw) => write(`data: ${raw}\n\n`),
      });

      // Announce this connection to everyone else — covers both "a new
      // person just came online" and "someone's browser reconnected after a
      // blip", uniformly: presence is just a timestamp refresh either way, so
      // there's no offline-then-online transition to cause a flicker.
      await broadcastRoomUpdate(id);

      // Doubles as the presence refresh (see file header) and, as a cheap
      // self-heal, re-sends this client its own room snapshot — insurance
      // against a pub/sub message that arrived while this connection was
      // briefly re-establishing. Comment-only frames would keep intermediary
      // proxies from treating a quiet stream as dead; sending real data does
      // that and more.
      heartbeat = setInterval(async () => {
        await touchPresence(id, userId);
        const snap = await getRoomSnapshot(id);
        if (snap) writeEvent({ type: "room", room: snap });
      }, HEARTBEAT_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx-style proxies not to buffer, which would defeat the point.
      "X-Accel-Buffering": "no",
    },
  });
}
