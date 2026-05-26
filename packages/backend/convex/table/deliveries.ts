import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";

/**
 * 2.6-A — `deliveries` (PRD 40 Livraison Uber Direct, delivery CONTEXT, ADR
 * 0010). One row per order's fulfilment: either an Uber Direct delivery course
 * or a click & collect pickup (both activated by default per tenant, PRD 40 §V1
 * / Q40-Q8). The internal `status` is DERIVED from the Uber Direct webhook events
 * (PRD 40 §4); for click & collect there is no Uber course (so no
 * `uberDeliveryId`).
 *
 * TENANT-SCOPED (carries `tenantId`, ADR 0010): every read/write goes through the
 * tenancy wrappers (`tenantQuery` / `tenantMutation`) and reaches this table only
 * through the sanctioned `lib/tenancy/deliveriesStore` seam — never raw `ctx.db`
 * in the `lib/uberDirect` business module (`no-untenanted-query`, 1.x-H). The
 * module ships a cross-tenant fuzz test.
 *
 * `orderId` is a loose string FK: the `orders` table is built by a later chantier
 * (2.2/2.3) and does not exist yet, so we store the KB order reference as a
 * string (it doubles as Uber's `manifest_reference`, research §1.4) rather than
 * `v.id("orders")`. Tighten to a typed id once the `orders` table lands.
 */

/**
 * Internal delivery status, mapped 1:1 onto the documented Uber Direct delivery
 * statuses (research/uber_direct_deep_dive §1.3): `pending`, `pickup`,
 * `pickup_complete`, `dropoff`, `delivered`, `canceled`, `returned`, `failed`.
 * For click & collect the lifecycle stays in {`pending`, `pickup_complete`
 * (ready), `delivered` (collected)} — no courier dispatch. Not invented: these
 * are Uber's own status names.
 */
export const deliveryStatus = v.union(
  v.literal("pending"),
  v.literal("pickup"),
  v.literal("pickup_complete"),
  v.literal("dropoff"),
  v.literal("delivered"),
  v.literal("canceled"),
  v.literal("returned"),
  v.literal("failed"),
);

/** Fulfilment mode chosen by the client at checkout (PRD 40 §V1 / Q40-Q8). */
export const deliveryMode = v.union(
  v.literal("delivery"),
  v.literal("click_collect"),
);

/**
 * The 3 distinct incident cases that need an explicit record (PRD 40 §5,
 * Q40-Q13): course refused by Uber post-payment, an incident after pickup, and
 * the customer-absent return. (Case B — courier re-dispatch before pickup — is
 * silent and leaves no incident, PRD 40 §5 Cas B.)
 */
export const deliveryIncidentType = v.union(
  v.literal("refused_post_payment"),
  v.literal("incident_after_pickup"),
  v.literal("customer_absent"),
);

export type DeliveryStatus = Infer<typeof deliveryStatus>;
export type DeliveryMode = Infer<typeof deliveryMode>;
export type DeliveryIncidentType = Infer<typeof deliveryIncidentType>;

export const deliveries = defineTable({
  tenantId: v.id("tenants"),
  // KB order reference (string FK — see header; orders table is a later chantier).
  orderId: v.string(),
  mode: deliveryMode,
  // Absent in click & collect (no Uber course); set once Uber returns it.
  uberDeliveryId: v.optional(v.string()),
  status: deliveryStatus,
  // Courier/quote tracking — populated from quotes + webhooks (PRD 40 §3/§4).
  pickupEta: v.optional(v.number()),
  dropoffEta: v.optional(v.number()),
  // Visible to KB Orders, NOT exposed to the client in V1 (PRD 40 §4).
  courierName: v.optional(v.string()),
  courierPhone: v.optional(v.string()),
  quoteId: v.optional(v.string()),
  quoteFee: v.optional(v.number()), // course fee in cents
  incidentType: v.optional(deliveryIncidentType),
  // Cumulative ETA slip; the "petit retard" push fires past 10 min (PRD 40 §5 B).
  cumulativeEtaDriftMs: v.optional(v.number()),
  // 2.6-D — set true on a `customer_absent` (Cas D, PRD 40 §5 / Q40-Q13): the
  // resto MAY then issue a discretionary refund (geste commercial) — exposed to
  // KB Orders as a manual refund button. There is NO auto-refund for Cas D.
  manualRefundAvailable: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_tenant", ["tenantId"])
  .index("by_order", ["tenantId", "orderId"])
  .index("by_uber_delivery_id", ["uberDeliveryId"]);
