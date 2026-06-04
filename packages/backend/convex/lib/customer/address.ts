import { v } from "convex/values";
import {
  customerMutation,
  getOrCreateCustomerFiche,
  patchCustomerAddress,
} from "../tenancy";

/**
 * PWA-S3 (#451) — `updateAddress`: stamp the Google-Places-normalised address
 * (+ lat/lng) on the caller's OWN `customers` fiche, as the second link of the
 * address-first chain (decisions-log Q7, customer-data CONTEXT « Anonymous
 * account » + « Position géo (lat/lng) »):
 *
 *   signIn("anonymous")          // PWA-S3 frontend (Convex Auth Anonymous)
 *   → getOrCreateCurrentCustomer  // 2.1-B silent provisioning
 *   → updateAddress               // THIS slice
 *   → requestDeliveryQuote        // 2.6-B address-first verdict
 *
 * The form forbids free typing (Google Places suggestion required, V1 decision
 * actée 2026-05-23), so the mutation accepts a NON-OPTIONAL address triplet:
 * a caller cannot smuggle a partial-undefined patch through this surface.
 * Re-submitting from the edit-after-validation UX (Q7) OVERWRITES the previous
 * address — the form re-fires the quote on every change, the persisted fiche
 * just reflects the latest Places selection.
 *
 * Self-scoped via `customerMutation`: the handler only ever sees
 * `ctx.actor.userId` (resolved by `getCurrentActor`, ADR 0011), and reaches the
 * GLOBAL `customers` table ONLY through the sanctioned tenancy seam
 * (`patchCustomerAddress`) — never raw `ctx.db` in this business module (ADR
 * 0010 / `no-untenanted-query`). Tolerates a missing fiche (provisions one on
 * the fly via `getOrCreateCustomerFiche`) so the chain stays robust if a future
 * refactor collapses `getOrCreateCurrentCustomer` + `updateAddress`.
 */
export const updateAddress = customerMutation({
  args: {
    address: v.string(),
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (ctx, { address, lat, lng }): Promise<void> => {
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    await patchCustomerAddress(ctx, customerId, { address, lat, lng });
  },
});
