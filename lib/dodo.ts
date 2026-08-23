import DodoPayments from "dodopayments";

// Defaults to test mode rather than the SDK's own default (live_mode) so a
// missing/misconfigured env var can't accidentally take real payments.
const environment = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";

export const dodo = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
  environment,
});
