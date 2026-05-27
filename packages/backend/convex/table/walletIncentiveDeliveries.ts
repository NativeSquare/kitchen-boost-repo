import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.8-E — `walletIncentiveDeliveries`, the ledger of the Incentive Wallet reward
 * delivered to a Customer once their pass is REALLY installed (PRD 80 / ADR 0002,
 * [[Incentive Wallet]] glossaire client-ordering, US 19 / US 20 / US 24).
 *
 * ── The non-negotiable contract: no fake reward (ADR 0002, US 19) ───────────────
 * The Incentive reward code is delivered ONLY on a real `pass_installed` event
 * (slice C, #70). A row in THIS table is the PROOF a delivery happened — and the
 * single write site (the `lib/tenancy/walletIncentiveDeliveriesStore` seam) is only
 * ever reached from `linkSerialToCustomer`, which runs inside the install handler's
 * `withIdempotence` block. There is NO alternative generation path, so a row cannot
 * exist without a constated install.
 *
 * ── Exactly once per install (US 20) ───────────────────────────────────────────
 * `serialNumber` is UNIQUE here (applicative, on `by_serial`, same convention as
 * `walletPasses.by_serial` / `customers.by_user`): ONE reward per pass, never per
 * device. A redelivered event is a no-op via `withIdempotence`; a 2ⁿᵈ device on the
 * SAME pass is additionally caught by the data-level guard (one row per serial).
 *
 * ── GLOBAL, NO authoritative `tenantId` (ADR 0003 / ADR 0010) ──────────────────
 * The Incentive rides on the COMMON neutral card, which carries no authoritative
 * `tenantId` (like `walletPasses` / `customers`). This table is therefore GLOBAL:
 * the delivery is keyed on the GLOBAL pass serial + the GLOBAL `customerId`, with no
 * `tenantId` to scope on. The `no-untenanted-query` rule does not apply by tenant
 * here; access still goes EXCLUSIVELY through the sanctioned `lib/tenancy` seam
 * (`walletIncentiveDeliveriesStore`), never raw `ctx.db` in the `lib/wallet` module.
 *
 * ── Out of scope: the parametrisation (Phase 3) ────────────────────────────────
 * The resto's hook text + the promo code VALUE are edited in KB Admin in Phase C
 * (a Phase-3 front, OUT OF SCOPE of #72). So this table records only the delivery
 * FACT (which Customer / which pass / when) — it stores NO invented promo string.
 */
export const walletIncentiveDeliveries = defineTable({
  // The pass serial whose REAL install triggered this delivery. UNIQUE here
  // (applicative, by_serial) — one reward per pass.
  serialNumber: v.string(),

  // The Customer the pass was generated for (the install resolves to it via the
  // GLOBAL `walletPasses` seam). Stored by id only — never a raw customer object.
  customerId: v.id("customers"),

  // When the Incentive was delivered (the constated install timestamp).
  deliveredAt: v.number(),
}).index("by_serial", ["serialNumber"]); // unique (enforced applicatively)
