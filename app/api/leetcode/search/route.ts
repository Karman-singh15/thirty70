import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { searchProblems } from "@/lib/leetcode";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

// Every request here becomes a request to leetcode.com from this deployment's
// IP. One user in a loop therefore doesn't degrade their own experience — they
// get the whole app rate-limited or blocked upstream. The client debounces at
// 300ms, so a person typing a search reaches maybe 10-15 of these a minute;
// 60 leaves that untouched.
const SEARCHES_PER_MINUTE = 60;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`leetcode-search:${userId}`, SEARCHES_PER_MINUTE, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ problems: [] });
  }

  try {
    const problems = await searchProblems(q);
    return NextResponse.json({ problems });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
