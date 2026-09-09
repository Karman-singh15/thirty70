import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getProblem } from "@/lib/leetcode";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

// Same upstream exposure as the search route. Fetching a problem happens once
// per problem pick and once per client on load, so 60/min is far above real use.
const FETCHES_PER_MINUTE = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`leetcode-problem:${userId}`, FETCHES_PER_MINUTE, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const { slug } = await params;

  try {
    const problem = await getProblem(slug);

    if (!problem) {
      return NextResponse.json({ error: "Problem not found" }, { status: 404 });
    }

    return NextResponse.json({ problem });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch problem";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
