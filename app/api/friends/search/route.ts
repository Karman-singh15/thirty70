import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { searchUsers } from "@/lib/social";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

// Finds people to add. Every result carries the viewer's relationship to it,
// so the row can offer the one button that makes sense rather than offering
// Add and then failing with "you're already friends".
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The client debounces, so a person typing lands well inside this. It's
  // here for the case the debounce doesn't cover: a script walking the user
  // table one prefix at a time.
  const limit = await rateLimit(`user-search:${userId}`, 40, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const query = req.nextUrl.searchParams.get("q") ?? "";

  return NextResponse.json({ results: await searchUsers(userId, query) });
}
