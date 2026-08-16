import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isRoomMember } from "@/lib/rooms";
import { getLiveState, subscribeEditorEvents, type EditorEvent } from "@/lib/roomState";

// Server-sent events carrying the shared editor's state. This is the push
// channel the room was missing: edits reach everyone in roughly the time of
// one Redis publish rather than waiting out a poll interval.
//
// It only carries the document. Turn state, presence and media still ride the
// 1.5s /sync poll — that poll is also what keeps presence alive, so it can't
// simply be replaced by this.

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

      // Open with the current document so a client that just connected (or
      // reconnected after a drop) is immediately in sync, with no separate
      // fetch and no window where it would apply edits to a stale buffer.
      const live = await getLiveState(id);
      const snapshot: EditorEvent = {
        type: "doc",
        version: live.docVersion,
        code: live.code,
        language: live.language,
      };
      write(`data: ${JSON.stringify(snapshot)}\n\n`);

      unsubscribe = subscribeEditorEvents(id, (raw) => write(`data: ${raw}\n\n`));

      // Comment frames keep intermediaries from treating a quiet stream as
      // dead and closing it.
      heartbeat = setInterval(() => write(`: ping\n\n`), HEARTBEAT_MS);
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
