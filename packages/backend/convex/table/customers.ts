import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.1-A — `customers`, the MOAT of KitchenBoost (PRD 90 / customer-data CONTEXT).
 *
 * ── GLOBAL, NO `tenantId` — DOCUMENTED ISOLATION EXEMPTION (ADR 0010) ──────────
 * This is the ONE business table that is deliberately NOT tenant-scoped. Its
 * GLOBALITY *is* the moat: a single customer who orders at two KitchenBoost
 * restaurants is the SAME `customers` record (cross-tenant), owned by KB (RGPD
 * responsable de traitement, contrat Article 2 ter). Tenant-scoping it would
 * destroy the moat. Liaison to tenants is carried OUT-OF-BAND by the N-N link
 * table `customerOrdersPerTenant` (which DOES carry `tenantId`), so no isolation
 * boundary is lost — the per-tenant view is reconstructed from the link, never
 * from a `tenantId` on the customer.
 *
 * The `no-untenanted-query` ESLint rule (1.x-H / #26, active) therefore does NOT
 * apply to reads/writes of THIS table by tenant: there is no `tenantId` to scope
 * on. Access still goes EXCLUSIVELY through the sanctioned tenancy wrappers
 * (`kbAdminQuery/Mutation` root, `customerQuery/Mutation` self) — never a raw
 * `ctx.db.query("customers")` in business code. The wrappers live in the exempt
 * `convex/lib/tenancy/**` path (alongside this `convex/table/**` foundation
 * file), so the rule's `ignores` cover both ends; new 2.x business modules get
 * NO exemption and must route through those wrappers.
 *
 * ── Identity (ADR 0008) ───────────────────────────────────────────────────────
 * A customer = an anonymous Convex Auth `users` row (FK `userId`). NO unique
 * constraint on `email`/`phone`: cross-device duplicates are assumed (V1 has no
 * server-side email/tel match — recognition is cookie-device intra-resto + the
 * Wallet pass serial cross-resto). Several rows may share an email/phone.
 *
 * ── Consent (ADR 0007, supersedes the checkbox ADR 0001) ──────────────────────
 * Consent is captured by the click on "Payer": `cgvAcceptedAt` (timestamp) +
 * `cgvVersionHash` (SHA-256 of the active CGV wording, archived in `cgvVersions`).
 * There are deliberately NO `consentMarketing` / `consentTransactional` booleans
 * (superseded by ADR 0007 + ADR 0005 re-consent-by-purchase). Marketing
 * eligibility is COMPUTED later (slice) from `cgvAcceptedAt` /
 * `marketingOptOutDate` / `lastCheckoutAt`.
 *
 * ── Push enrollment (ADR 0012) ────────────────────────────────────────────────
 * The push IDENTITY + REACHABILITY live HERE (Customer Data owns "who is reachable
 * and by which id"; Notifications owns the sending). The Wallet `serial_number`
 * is also the cross-device identity bridge (ADR 0008). Modelled as a single
 * optional `pushEnrollment` object so RGPD anonymisation (slice F) nullifies it
 * in one geste. The web-push SENDING credential (VAPID keys) belongs to
 * Notifications (2.7), not here.
 *
 * Written field-by-field by later 2.1 slices + chantier 2.3 (orders touch
 * `lastCheckoutAt`); this slice only lays the table + the `by_user` index.
 */

/** Per-channel push enrollment status (ADR 0012). */
const pushChannelStatus = v.union(
  v.literal("enrolled"),
  v.literal("not_enrolled"),
  v.literal("revoked"),
);

export const customers = defineTable({
  // FK → the anonymous Convex Auth user that IS this customer (ADR 0008).
  userId: v.id("users"),

  // Captation au checkout (PRD 90 §2) — all optional: a fiche may exist before
  // the first completed checkout, and RGPD anonymisation nullifies them.
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  firstName: v.optional(v.string()), // V1 — family name deferred V2
  address: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),

  // Consentement par clic Payer (ADR 0007). NO consent booleans (ADR 0007/0005).
  cgvAcceptedAt: v.optional(v.number()),
  cgvVersionHash: v.optional(v.string()), // SHA-256, FK-by-value → cgvVersions.hash

  // Marketing opt-out + last checkout drive marketing_eligible (ADR 0005).
  marketingOptOutDate: v.optional(v.number()),
  lastCheckoutAt: v.optional(v.number()),

  // RGPD effacement = irreversible anonymisation (ADR, slice F). Set once the
  // personal fields above have been nullified.
  anonymizedAt: v.optional(v.number()),

  // 2.5-D — saved card reusable cross-resto (Stripe Customer cross-tenant, PRD 30,
  // payment CONTEXT "Stripe Customer (cross-tenant)"). The Stripe `Customer` lives
  // at the KB PLATFORM account level (NOT tenant) — so it naturally belongs on this
  // GLOBAL fiche, which carries no tenantId. `stripeCustomerId` (`cus_…`) is the
  // platform Customer; `savedPaymentMethodId` (`pm_…`) is the card SAVED on it. At
  // checkout on resto X, KB CLONES that PaymentMethod to resto X's connected account
  // and direct-charges the clone (POC #6) — the original here stays intact, re-
  // clonable to resto Y next time. Both optional: a fiche may have no saved card.
  stripeCustomerId: v.optional(v.string()),
  savedPaymentMethodId: v.optional(v.string()),

  // Push enrollment / reachability (ADR 0012) — identity + joignabilité, not the
  // sending credentials. Single object → one-geste nullification on anonymise.
  pushEnrollment: v.optional(
    v.object({
      walletSerialNumber: v.optional(v.string()), // cross-device identity bridge
      webPushSubscriptionId: v.optional(v.string()),
      walletStatus: v.optional(pushChannelStatus),
      webPushStatus: v.optional(pushChannelStatus),
      a2hsStatus: v.optional(pushChannelStatus),
      // PWA-S6c (#457) — fallback escape hatch (decisions-log Q8 (5),
      // CONTEXT customer-data « Push enrollment »). Flipped to `true` by the
      // self-scoped `customer.pushEnrollment.markNoChannelPossible` mutation
      // after the user exhausts the 3-level frictional « Continuer sans
      // notifs » fallback (2 documented channel failures + 3 confirm screens
      // re-refused). Reachability falls back to SMS via Cascade Notifications
      // (~5% cas). Lives INSIDE this same object so anonymisation (slice F,
      // patches `pushEnrollment: undefined`) wipes it in one geste.
      noChannelPossible: v.optional(v.boolean()),
    }),
  ),

  createdAt: v.number(),
}).index("by_user", ["userId"]); // one fiche per user (enforced applicatively)
