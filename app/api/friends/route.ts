import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getSocialGraph } from "@/lib/social";

// Friends, requests waiting on you, and requests you're waiting on — one
// read, because the panel shows all three and fetching them separately would
// let the tab counts disagree with each other mid-render.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getSocialGraph(userId));
}
