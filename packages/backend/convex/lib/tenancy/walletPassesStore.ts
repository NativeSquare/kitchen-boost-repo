import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.8-A — the SANCTIONED data-access seam for the GLOBAL `walletPasses` table (the
 * common neutral Wallet card, ADR 0003 — like `customers`, no authoritative
 * `tenantId`, ADR 0010 documented exemption).
 *
 * `walletPasses` carries NO `tenantId`, so it is reached through the tenancy
 * module, never raw `ctx.db.query("walletPasses")` in business code
 * (`no-untenanted-query`, 1.x-H). This file lives in the EXEMPT `lib/tenancy/**`
 * path (alongside `customerFiche.ts`), so it is the single sanctioned place raw
 * `ctx.db` touches `walletPasses`. The business module `lib/wallet` (NOT exempt)
 * calls THESE helpers instead of `ctx.db`.
 *
 * The pass row holds TECHNICAL state only; the AUTHORITATIVE serial→customer
 * identity bridge lives in 2.1 (`customers.pushEnrollment.walletSerialNumber`,
 * ADR 0008/0012) and is NOT duplicated here.
 */

/** Read a pass by its (unique) serial number, or `null`. Keyed on `by_serial`. */
export async function readWalletPassBySerial(
  ctx: QueryCtx | MutationCtx,
  serialNumber: string,
): Promise<Doc<"walletPasses"> | null> {
  return ctx.db
    .query("walletPasses")
    .withIndex("by_serial", (q) => q.eq("serialNumber", serialNumber))
    .unique();
}

/** The fields of a freshly-generated pass row. */
export type NewWalletPass = {
  serialNumber: string;
  passTypeIdentifier: string;
  customerId: Id<"customers">;
  lastBrandTenantId?: Id<"tenants">;
};

/**
 * Insert a freshly-generated pass row (`status: "generated"`, `createdAt` stamped
 * here). System-side write from the generation action's internal mutation. The
 * single sanctioned `ctx.db.insert` site for the GLOBAL `walletPasses` table.
 * Returns the new row id.
 */
export async function insertWalletPass(
  ctx: MutationCtx,
  pass: NewWalletPass,
): Promise<Id<"walletPasses">> {
  return ctx.db.insert("walletPasses", {
    serialNumber: pass.serialNumber,
    passTypeIdentifier: pass.passTypeIdentifier,
    customerId: pass.customerId,
    lastBrandTenantId: pass.lastBrandTenantId,
    status: "generated",
    createdAt: Date.now(),
  });
}

/**
 * 2.8-C — flip a pass row to `installed` once the device confirms the install
 * (Apple PassKit register / Google Wallet add). Stamps `installedAt` (kept on the
 * FIRST install — a re-install of the same pass is a no-op re-stamp, harmless).
 * The single sanctioned `ctx.db.patch` site for the install state of the GLOBAL
 * `walletPasses` table; the business module `lib/wallet` (NOT exempt) calls THIS
 * instead of raw `ctx.db` (ADR 0010). This carries only the TECHNICAL pass state —
 * the AUTHORITATIVE serial→customer identity bridge is written into 2.1
 * (`customers.pushEnrollment`), never duplicated here.
 */
export async function setWalletPassInstalled(
  ctx: MutationCtx,
  passId: Id<"walletPasses">,
  at: number,
): Promise<void> {
  await ctx.db.patch(passId, { status: "installed", installedAt: at });
}
