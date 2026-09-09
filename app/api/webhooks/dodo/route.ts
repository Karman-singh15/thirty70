import { NextRequest, NextResponse } from "next/server";
import { dodo } from "@/lib/dodo";
import { applySubscriptionEvent } from "@/lib/billing";
import { report } from "@/lib/log";

// Every event that carries a subscription's current status — the payload
// shape (data: SubscriptionsAPI.Subscription) is identical across all of
// them, only `type` differs, so one handler covers the whole lifecycle.
const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.on_hold",
  "subscription.paused",
  "subscription.unpaused",
  "subscription.cancelled",
  "subscription.failed",
  "subscription.expired",
]);

export async function POST(req: NextRequest) {
  const body = await req.text();

  let event;
  try {
    event = dodo.webhooks.unwrap(body, {
      headers: {
        "webhook-id": req.headers.get("webhook-id") ?? "",
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      },
    });
  } catch (err) {
    // Either Dodo's key rotated or something is forging webhooks at us.
    // Both are worth knowing about; neither is visible from a 401 alone.
    report("dodo_webhook.signature_rejected", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    const data = event.data as {
      status: string;
      subscription_id: string;
      customer: { customer_id: string };
      metadata?: Record<string, string | number | boolean>;
    };
    await applySubscriptionEvent(data);
  }

  return NextResponse.json({ received: true });
}
