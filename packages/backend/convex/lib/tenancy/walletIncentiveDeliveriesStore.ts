import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.8-E — the SANCTIONED data-access seam for the GLOBAL `walletIncentiveDeliveries`
 * table (the Incentive Wallet conditional-delivery ledger, ADR 0002 / ADR 0003 — like
 * `walletPasses` / `customers`, no authoritative `tenantId`, ADR 0010 documented
 * exemption).
 *
 * The table carries NO `tenantId`, so it is reached through the tenancy module, never
 * raw `ctx.db.query("walletIncentiveDeliveries")` in business code (`no-untenanted-query`,
 * 1.x-H). This file lives in the EXEMPT `lib/tenancy/**` path (alongside
 * `walletPassesStore.ts`), so it is the single sanctioned place raw `ctx.db` touches
 * the table. The business module `lib/wallet` (NOT exempt) calls THESE helpers.
 *
 * The delivery row is the PROOF a reward was issued for a REALLY-installed pass (no
 * fake reward, US 19); the helpers below enforce ONE delivery per serial (US 20).
 */

/** Read the Incentive delivery for a pass serial, or `null`. Keyed on `by_serial`. */
export async function readIncentiveDeliveryBySerial(
  ctx: QueryCtx | MutationCtx,
  serialNumber: string,
): Promise<Doc<"walletIncentiveDeliveries"> | null> {
  return ctx.db
    .query("walletIncentiveDeliveries")
    .withIndex("by_serial", (q) => q.eq("serialNumber", serialNumber))
    .unique();
}

/** The fields of a freshly-recorded Incentive delivery. */
export type NewIncentiveDelivery = {
  serialNumber: string;
  customerId: Id<"customers">;
  deliveredAt: number;
};

/**
 * Record an Incentive delivery EXACTLY ONCE per pass serial (US 20). Returns `true`
 * when a row was inserted (first delivery for this pass), `false` when one already
 * existed (a redelivered event / a 2ⁿᵈ device on the SAME pass — no second reward).
 * The single sanctioned `ctx.db.insert` site for the GLOBAL table. The caller has
 * already proven the install is REAL (the serial resolves to an installed pass) —
 * this seam never issues a reward on its own (no fake reward, US 19).
 */
export async function recordIncentiveDeliveryOnce(
  ctx: MutationCtx,
  delivery: NewIncentiveDelivery,
): Promise<boolean> {
  const existing = await readIncentiveDeliveryBySerial(
    ctx,
    delivery.serialNumber,
  );
  if (existing !== null) return false;

  await ctx.db.insert("walletIncentiveDeliveries", {
    serialNumber: delivery.serialNumber,
    customerId: delivery.customerId,
    deliveredAt: delivery.deliveredAt,
  });
  return true;
}
