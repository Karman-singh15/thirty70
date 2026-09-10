import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { dodo } from "@/lib/dodo";
import type { UserPlan } from "@/lib/roomLimits";
import { env } from "@/lib/env";

// Subscription statuses that mean "this user should have the pro plan right
// now" — see SubscriptionStatus in dodopayments/resources/subscriptions.
// Everything else (on_hold, paused, cancelled, failed, expired) downgrades.
const ACTIVE_STATUSES = new Set(["active"]);

export async function getUserPlan(userId: string): Promise<UserPlan> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { plan: true },
  });
  return row?.plan ?? "free";
}

export async function createUpgradeCheckout(
  userId: string,
  email: string,
  name: string
): Promise<string> {
  const productId = env.DODO_PAYMENTS_PRO_PRODUCT_ID;
  if (!productId) {
    throw new Error("DODO_PAYMENTS_PRO_PRODUCT_ID is not configured");
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // metadata.userId is what lets the webhook match a subscription event back
  // to a row here without trusting anything the client sent — Dodo echoes it
  // back on every event for this checkout's subscription/payment.
  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { email, name },
    metadata: { userId },
    return_url: `${appUrl}/dashboard?upgrade=success`,
  });

  // Only absent when `payment_method_id` was passed to create(), which we
  // never do — this is always a hosted-checkout session.
  if (!session.checkout_url) {
    throw new Error("Dodo checkout session was created without a checkout_url");
  }
  return session.checkout_url;
}

// Applied from the webhook route for every subscription.* event. Trusts only
// data that's already been signature-verified by the caller.
export async function applySubscriptionEvent(data: {
  status: string;
  subscription_id: string;
  customer: { customer_id: string };
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  const plan: UserPlan = ACTIVE_STATUSES.has(data.status) ? "pro" : "free";
  const metadataUserId = data.metadata?.userId;

  const set = {
    plan,
    dodoCustomerId: data.customer.customer_id,
    dodoSubscriptionId: data.subscription_id,
  };

  if (typeof metadataUserId === "string" && metadataUserId) {
    await db.update(users).set(set).where(eq(users.id, metadataUserId));
    return;
  }

  // Fallback for events that don't carry our metadata (e.g. triggered from
  // the Dodo dashboard rather than the checkout we created) — match by the
  // subscription id we stored on the original checkout's webhook instead.
  await db
    .update(users)
    .set(set)
    .where(eq(users.dodoSubscriptionId, data.subscription_id));
}
