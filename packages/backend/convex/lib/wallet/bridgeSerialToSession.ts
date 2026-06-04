import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalQuery } from "../../_generated/server";
import { readCustomerFicheById, readWalletPassBySerial } from "../tenancy";

/**
 * PWA-S9b (#461) — `resolveSerialForBridge`, the system-side resolver of the
 * CROSS-DEVICE / CROSS-RESTO identity BRIDGE at the tap-deep-link surface
 * (decisions-log Q5 « Bridge identité au tap deep-link », US 39 / 40 / 41 / 42,
 * ADR 0008 / ADR 0012).
 *
 * ── Surface chain ─────────────────────────────────────────────────────────────
 * The Wallet pass back-of-pass URL embeds `?wallet=<serialNumber>` (configured
 * by chantier 2.8). When the client taps the pass on a brand-new device (US 40)
 * or on a DIFFERENT KB resto (US 41), the PWA edge middleware
 * (`apps/web/src/proxy.ts`) intercepts the param via the pure decision
 * `decideWalletBridgeInterception` (PWA-S9b frontend), sets a short-lived
 * `__Host-kb_wallet_bridge_pending` cookie and 307-redirects to the clean URL
 * (US 42 « URL `?wallet=` cleared après bridge »). The client `<WalletBridgeRunner>`
 * then calls `signIn("wallet-bridge", { serial })` — the `WalletBridge`
 * `ConvexCredentials` provider in `auth.ts` is the only legit caller of THIS
 * internal query; its `authorize` returns `{ userId }` from our `{ userId,
 * customerId }` (it does not need `customerId`, but downstream tests assert
 * the resolved id matches the seeded fiche).
 *
 * ── Source of truth (ADR 0008 / ADR 0012) ─────────────────────────────────────
 * The pass row carries the AUTHORITATIVE `customerId` (fixed at generation,
 * 2.8-A — see `lib/wallet/generatePass`). The `customers` fiche carries the
 * `userId` (the anonymous Convex Auth user, ADR 0008). So the full bridge
 * chain is `serial → walletPasses → customerId → customers → userId`. The
 * chain is keyed on the GLOBAL `walletPasses` table (no `tenantId` — ADR 0003
 * carte commune marque neutre); the resto isolation is the SEPARATE
 * `__Host-kb_tenant` cookie set by `decideTenantResolution`, not by this
 * resolver.
 *
 * ── Internal (system seam) — NEVER client-callable ────────────────────────────
 * The serial is opaque but USER-VISIBLE (printed on the back of the pass), so
 * a probing client could enumerate other customers' serials. The wrapper is
 * therefore `internalQuery` — the `WalletBridge` provider runs INSIDE the
 * Convex Auth `signIn` action (server-side, no user surface), the only legit
 * caller. The public `signIn("wallet-bridge", { serial })` IS the surface; the
 * provider's `authorize` fails CLOSED (returns `null`) for any unknown serial
 * so the client cannot distinguish "unknown" from "rejected" — there is NO
 * FORBIDDEN throw on this path (no existence leak, same discipline as
 * `checkInstallStatus`).
 *
 * ── No raw `customer` leak (MOAT) ─────────────────────────────────────────────
 * Returns ONLY `{ userId, customerId }` — never a raw `customer` object. Per
 * ADR 0010 / ADR 0011, the MOAT (no raw customer object reaches a manager)
 * holds structurally: `userId` is opaque to PRO, and `customerId` is the same
 * id the `customerQuery` wrappers self-scope on downstream.
 *
 * ── Sanctioned tenancy seam (ADR 0010 / 0011) ─────────────────────────────────
 * Reads go through `readWalletPassBySerial` (GLOBAL `walletPasses`, sanctioned
 * via `lib/tenancy/walletPassesStore`) + `readCustomerFicheById` (GLOBAL
 * `customers`, sanctioned via `lib/tenancy/customerFiche`). Never raw
 * `ctx.db.query("walletPasses")` / `ctx.db.query("customers")` — the
 * `lib/wallet` business module is NOT exempt from `no-untenanted-query`.
 * Identity is irrelevant here (system seam, called before any session exists):
 * there is no `getCurrentActor` because the caller IS the auth framework.
 *
 * ── Closed failure modes (US 42 « graceful ») ─────────────────────────────────
 *  - Unknown serial → `null` (no fabricated link, no FORBIDDEN throw).
 *  - Pass exists but fiche has vanished (RGPD anonymisation hard-delete in a
 *    test scenario, or orphan) → `null` (never fabricate a session for a
 *    userId we cannot read back).
 *  - Pass status is not `"installed"` (e.g. `"inactive"` — customer remotely
 *    removed the pass from Wallet) → `null`. A revoked card must NOT silently
 *    re-grant access; the caller re-onboards via the normal anonymous flow.
 *  - Pass status is `"generated"` (signed but never confirmed installed) →
 *    `null`. The bridge is only meaningful for a constated install — same
 *    discipline as 2.8-E `deliverIncentive` (no fake reward, US 19).
 */
export const resolveSerialForBridge = internalQuery({
  args: { serialNumber: v.string() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      customerId: v.id("customers"),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{
    userId: Id<"users">;
    customerId: Id<"customers">;
  } | null> => {
    const pass = await readWalletPassBySerial(ctx, args.serialNumber);
    if (pass === null) {
      // Unknown serial — fail closed, no existence leak.
      return null;
    }
    if (pass.status !== "installed") {
      // The pass was never installed (still `generated`) or has been
      // remotely revoked (`inactive`). Both reduce to « no bridge » — the
      // client falls back to a normal anonymous sign-in.
      return null;
    }
    const fiche = await readCustomerFicheById(ctx, pass.customerId);
    if (fiche === null) {
      // The pass's customer fiche has vanished. Never fabricate a session
      // for a userId we cannot read back — fail closed.
      return null;
    }
    return { userId: fiche.userId, customerId: pass.customerId };
  },
});
