import { defineTable } from "convex/server";
import { v } from "convex/values";

// Idempotence ledger for external webhooks (Stripe, Uber Direct, Resend...).
// withIdempotence (1.x-F) checks by_provider_event before dispatching a handler.
export const processedWebhookEvents = defineTable({
  provider: v.string(),
  externalId: v.string(),
  processedAt: v.number(),
}).index("by_provider_event", ["provider", "externalId"]); // unique (enforced applicatively)
