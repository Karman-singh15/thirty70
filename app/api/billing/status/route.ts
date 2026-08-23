import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserPlan } from "@/lib/billing";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await getUserPlan(userId);
  return NextResponse.json({ plan });
}
