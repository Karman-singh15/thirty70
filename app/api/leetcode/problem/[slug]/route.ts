import { NextRequest, NextResponse } from "next/server";
import { getProblem } from "@/lib/leetcode";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
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
