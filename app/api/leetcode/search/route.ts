import { NextRequest, NextResponse } from "next/server";
import { searchProblems } from "@/lib/leetcode";

export async function GET(req: NextRequest) {
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
