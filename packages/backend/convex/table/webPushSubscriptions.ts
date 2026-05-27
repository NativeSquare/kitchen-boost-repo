import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.1-G — `webPushSubscriptions`, the persisted Web Push subscription objects the
 * Notifications send layer (#54) needs to encrypt + POST a push (RFC 8291). PRD 90
 * Customer Data, notifications CONTEXT « Push subscription », ADR 0012 (push split
 * 2.1/2.7).
 *
 * ── Why a dedicated TENANT-SCOPED table (not a field on the fiche) ──────────────
 * `customers.pushEnrollment` only holds an opaque `webPushSubscriptionId` + the
 * per-channel `webPushStatus` (reachability, ADR 0012) — NOT the `endpoint` nor the
 * encryption keys, which do not re-derive and so must be PERSISTED for #54. A
 * customer has MANY web-push subscriptions: the channel is scoped to the tenant
 * (« 1 origine = 1 channel », never cross-tenant — CONTEXT « Push web ») × several
 * devices ⇒ a 1-N relation, impossible in a single field on the GLOBAL fiche.
 *
 * ── Mirror of `walletDeviceRegistrations`, but INVERSE on tenancy (ADR 0010) ────
 * Like the Wallet device registry, this is a per-device push registry with a soft
 * `inactive` status (no hard delete — auditable history) and an idempotent upsert.
 * But the Wallet card is the COMMON neutral cross-tenant card (table GLOBAL, ADR
 * 0003), whereas web-push is per-origin/tenant — so this table CARRIES `tenantId`,
 * goes through the tenancy wrappers, and ships the mandatory cross-tenant fuzz
 * test. It is a tenant-scoped SATELLITE of the GLOBAL `customers` fiche (which has
 * no `tenantId` — the MOAT), exactly like `customerOrdersPerTenant`.
 *
 * ── The Web Push subscription (RFC 8291 / Push API) ────────────────────────────
 *  - `customerId` — the GLOBAL MOAT fiche, referenced BY ID only (no nominative
 *    coordinate copied here — ADR 0012).
 *  - `tenantId` — the resto origin (web-push is per-origin); the tenancy scoping key.
 *  - `endpoint` — the push service URL the message is POSTed to. The idempotence key.
 *  - `p256dh`, `auth` — the CLIENT public encryption keys (RFC 8291). Runtime data,
 *    not a server secret — the VAPID server keys are a 2.7 credential, never stored
 *    here (CONTEXT « VAPID »).
 *  - `status` — `active` while the device should receive pushes, `inactive` after a
 *    410 Gone on the endpoint (soft flip, never a hard delete — history kept, same
 *    convention as `walletDeviceRegistrations`).
 *  - `createdAt`, `updatedAt`.
 *
 * `endpoint` is UNIQUE (enforced applicatively on `by_endpoint`): a re-subscribe of
 * the same endpoint is IDEMPOTENT (refreshes the keys + re-activates, never a
 * duplicate row).
 *
 * ── Stores the subscription, never SENDS to it ────────────────────────────────
 * This slice is the storage plumbing ONLY (2.1). The actual web-push SEND (the
 * VAPID-signed Node route + dispatcher) is #54 (2.7), which READS the active
 * subscriptions of a (customer, tenant) couple through the tenancy seam.
 */
export const webPushSubscriptions = defineTable({
  // The GLOBAL MOAT fiche this subscription belongs to — referenced BY ID only.
  customerId: v.id("customers"),

  // The resto origin (web-push is per-origin) — the tenancy scoping key (ADR 0010).
  tenantId: v.id("tenants"),

  // The push service URL the encrypted message is POSTed to. The idempotence key.
  endpoint: v.string(),

  // The CLIENT public encryption keys (RFC 8291) — runtime data, NOT a server
  // secret (the VAPID server keys are a 2.7 credential, never stored here).
  p256dh: v.string(),
  auth: v.string(),

  // `active` while the device should receive pushes; `inactive` after a 410 Gone —
  // a SOFT flip, never a hard delete (auditable history, `walletDeviceRegistrations`
  // convention).
  status: v.union(v.literal("active"), v.literal("inactive")),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  // Fan-out of one customer's subscriptions.
  .index("by_customer", ["customerId"])
  // Tenant-scoped access (ADR 0010).
  .index("by_tenant", ["tenantId"])
  // The UNIQUE idempotence key — re-subscribe same endpoint = refresh + reactivate.
  .index("by_endpoint", ["endpoint"]);
