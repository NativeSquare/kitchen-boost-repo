import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.8-B — the SANCTIONED data-access seam for the GLOBAL
 * `walletDeviceRegistrations` table (the Apple Wallet Web Service device↔pass
 * registry, ADR 0003 carte commune — like `walletPasses` / `customers`, no
 * authoritative `tenantId`, ADR 0010 documented exemption).
 *
 * The table carries NO `tenantId`, so it is reached through the tenancy module,
 * never raw `ctx.db.query("walletDeviceRegistrations")` in business code
 * (`no-untenanted-query`, 1.x-H). This file lives in the EXEMPT `lib/tenancy/**`
 * path (alongside `walletPassesStore.ts`), so it is the single sanctioned place raw
 * `ctx.db` touches the registry. The business module `lib/wallet` (NOT exempt)
 * calls THESE helpers instead of `ctx.db`.
 *
 * The `(deviceLibraryIdentifier, serialNumber)` couple is UNIQUE (applicative, on
 * `by_device_serial`, same convention as `walletPasses.by_serial`): register is an
 * idempotent upsert, unregister a soft flip to `inactive` (history kept).
 */

/**
 * Read the registration of a (device, pass) couple, or `null`. Keyed on the unique
 * `by_device_serial` index.
 */
export async function readDeviceRegistration(
  ctx: QueryCtx | MutationCtx,
  deviceLibraryIdentifier: string,
  serialNumber: string,
): Promise<Doc<"walletDeviceRegistrations"> | null> {
  return ctx.db
    .query("walletDeviceRegistrations")
    .withIndex("by_device_serial", (q) =>
      q
        .eq("deviceLibraryIdentifier", deviceLibraryIdentifier)
        .eq("serialNumber", serialNumber),
    )
    .unique();
}

/** The fields of a freshly-created device registration. */
export type NewDeviceRegistration = {
  serialNumber: string;
  passTypeIdentifier: string;
  deviceLibraryIdentifier: string;
  pushToken: string;
};

/**
 * Insert a fresh `active` device registration (`createdAt` / `updatedAt` stamped
 * here). The single sanctioned `ctx.db.insert` site for the GLOBAL
 * `walletDeviceRegistrations` table. Returns the new row id.
 */
export async function insertDeviceRegistration(
  ctx: MutationCtx,
  reg: NewDeviceRegistration,
): Promise<Id<"walletDeviceRegistrations">> {
  const now = Date.now();
  return ctx.db.insert("walletDeviceRegistrations", {
    serialNumber: reg.serialNumber,
    passTypeIdentifier: reg.passTypeIdentifier,
    deviceLibraryIdentifier: reg.deviceLibraryIdentifier,
    pushToken: reg.pushToken,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Refresh an existing registration on an idempotent re-register: store the latest
 * `pushToken` and (re-)activate it. The single sanctioned `ctx.db.patch` site for
 * the registry. `updatedAt` is bumped.
 */
export async function refreshDeviceRegistration(
  ctx: MutationCtx,
  registrationId: Id<"walletDeviceRegistrations">,
  pushToken: string,
): Promise<void> {
  await ctx.db.patch(registrationId, {
    pushToken,
    status: "active",
    updatedAt: Date.now(),
  });
}

/**
 * Soft-deactivate a registration (the device unregistered, DELETE). Never a hard
 * delete — the row survives `inactive` so the history stays auditable. `updatedAt`
 * is bumped.
 */
export async function deactivateDeviceRegistration(
  ctx: MutationCtx,
  registrationId: Id<"walletDeviceRegistrations">,
): Promise<void> {
  await ctx.db.patch(registrationId, {
    status: "inactive",
    updatedAt: Date.now(),
  });
}

/**
 * List the ACTIVE registrations for a pass (its push fan-out targets — used by the
 * Wallet update slice D + the Web Service "passes updated since" reads). Keyed on
 * `by_serial`, filtered to `active`.
 */
export async function listActiveRegistrationsBySerial(
  ctx: QueryCtx | MutationCtx,
  serialNumber: string,
): Promise<Doc<"walletDeviceRegistrations">[]> {
  const rows = await ctx.db
    .query("walletDeviceRegistrations")
    .withIndex("by_serial", (q) => q.eq("serialNumber", serialNumber))
    .collect();
  return rows.filter((r) => r.status === "active");
}
