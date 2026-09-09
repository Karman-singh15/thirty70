import { NextRequest, NextResponse } from "next/server";
import { listRoomIdsForSweep, sweepIfAbandoned } from "@/lib/rooms";
import { getOnlineUserIds } from "@/lib/roomState";

// Backstop for abandoned rooms.
//
// The fast path is still getRoom: the moment anyone reads a room that's been
// empty past the grace window, it's disbanded. That covers every room someone
// eventually looks at again — but a room whose last member never comes back
// is never read again either, and only its Redis half expires on its own. The
// Postgres row, its participants, sessions and turns would otherwise sit
// there forever. This walks the whole table instead of waiting to be asked.
//
// Daily is deliberate rather than a compromise: this is the *only* consumer,
// nothing user-visible waits on it, and Vercel's Hobby plan allows one cron
// run per day. Scheduled in vercel.json.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel sends the cron secret as a bearer token. Refusing outright when
  // it isn't configured is the point — a misconfigured deployment should not
  // quietly leave a room-deleting endpoint open to the internet, and
  // proxy.ts has to let this path past Clerk for the cron to reach it at all.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roomIds = await listRoomIdsForSweep();

  // One at a time rather than Promise.all: a sweep is not latency-sensitive,
  // and firing hundreds of concurrent Postgres deletes at Neon's pooler to
  // save a few seconds on a job that runs once a day is a bad trade.
  let disbanded = 0;
  for (const roomId of roomIds) {
    try {
      const online = await getOnlineUserIds(roomId);
      if (await sweepIfAbandoned(roomId, online)) disbanded += 1;
    } catch {
      // One bad room shouldn't cost the rest of the sweep; the next run
      // retries it.
    }
  }

  return NextResponse.json({ scanned: roomIds.length, disbanded });
}
