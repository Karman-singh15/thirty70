import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getFriendIds } from "@/lib/social";
import {
  dropUserPresence,
  publishUserEvents,
  subscribeUserChannel,
  touchUserPresence,
} from "@/lib/userState";
import type { SocialEvent } from "@/lib/socialEvents";

// The signed-in user's own event stream: friend requests arriving, friends
// coming online, room invites. One per open tab, for the whole app rather
// than for one room — which is why it's mounted from the provider in the root
// layout and not from a page.
//
// Modelled on /api/rooms/[id]/stream, and for the same reason: a friend
// request that only shows up on reload isn't a friend request, it's a mailbox.
// The difference is the fan-out — this subscribes to one channel per user on
// a subscriber connection shared by every user on the instance, rather than a
// connection per room. See lib/userState.ts.

export const runtime = "nodejs";
// Vercel Hobby cuts a function at 60s and an SSE stream is a function that
// never returns, so this connection will be dropped on a schedule.
// EventSource reconnects by itself, every connection opens with a fresh
// presence write, and PRESENCE_WINDOW_MS is sized to ride out the gap.
export const maxDuration = 60;

// Doubles as the presence refresh — PRESENCE_WINDOW_MS in userState.ts is a
// bit over twice this, so one dropped ping doesn't flap a friend offline.
const HEARTBEAT_MS = 20_000;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
          // The client went away between the check above and this write.
          cleanup();
        }
      };
      const writeEvent = (event: SocialEvent) =>
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

      // Connecting is what "online" means here, so record it before telling
      // anyone anything — the friends notified below then read a presence set
      // that already includes this user.
      await touchUserPresence(userId);

      unsubscribe = subscribeUserChannel(userId, (raw) => write(`data: ${raw}\n\n`));

      // Open with a ping rather than a snapshot of the graph. The client
      // fetches /api/friends and /api/invites on mount anyway, and it treats
      // every event as "go and read the list again" (see SocialEvent), so
      // there's nothing a snapshot here would add beyond a second read of
      // Postgres on every reconnect.
      writeEvent({ type: "ping" });

      // Tell friends this user is reachable. Only the friends: presence is
      // not public, and there is nowhere else in the app it's shown.
      //
      // Sent on every connect, including reconnects after a dropped stream.
      // That's a redundant "still online" for a friend who never saw the gap,
      // and the alternative — tracking whether this is a true transition —
      // costs a round trip on a message that is idempotent by construction.
      const friendIds = await getFriendIds(userId);
      await publishUserEvents(friendIds, {
        type: "presence",
        userId,
        online: true,
      });

      heartbeat = setInterval(async () => {
        await touchUserPresence(userId);
        // Real bytes rather than a comment frame: keeps intermediary proxies
        // from treating a quiet stream as dead, same as the room stream.
        writeEvent({ type: "ping" });
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

// Sent by the browser on unload (see hooks/useSocial.tsx). Presence would
// time out on its own within the window, but a friend list that goes on
// showing someone as available for another 50 seconds is exactly the state
// that gets an invite sent into an empty room.
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dropUserPresence(userId);
  await publishUserEvents(await getFriendIds(userId), {
    type: "presence",
    userId,
    online: false,
  });

  return new NextResponse(null, { status: 204 });
}
