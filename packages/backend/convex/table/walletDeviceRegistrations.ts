import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.8-B — `walletDeviceRegistrations`, the device↔pass registry of the Apple
 * Wallet Web Service (PRD 80 Notifications, ADR 0003 carte commune marque neutre,
 * STACK §5.4). One row per (device, pass) couple that asked to receive APNs pushes
 * for a given pass.
 *
 * ── GLOBAL, NO authoritative `tenantId` (ADR 0003 / ADR 0010) ──────────────────
 * Like `walletPasses` (the pass it points at) and `customers` (the MOAT), this
 * table is deliberately GLOBAL: the common neutral card is ONE card for ALL restos,
 * so a device registration carries NO `tenantId` that "owns" it. There is nothing
 * to tenant-scope on. Tenant-scoping it would split the single cross-tenant push
 * channel that IS the moat. The `no-untenanted-query` rule therefore does NOT apply
 * by tenant here — access still goes EXCLUSIVELY through the sanctioned tenancy seam
 * (`lib/tenancy/walletDeviceRegistrationsStore`, alongside `walletPassesStore`),
 * never a raw `ctx.db.query("walletDeviceRegistrations")` in the `lib/wallet`
 * business module (which gets NO exemption).
 *
 * ── The Apple PassKit Web Service registration protocol ────────────────────────
 * When a user installs the `.pkpass`, the device calls the pass's `webServiceURL`
 * (`POST …/registrations/{deviceLibraryIdentifier}/{passTypeIdentifier}/{serial}`,
 * body `{ pushToken }`) so KitchenBoost can later push updates to it over APNs. On
 * uninstall / opt-out the device calls the `DELETE …` of the same triple. This
 * table records that couple:
 *  - `serialNumber` — the pass installed (FK-by-value → `walletPasses.serialNumber`).
 *  - `passTypeIdentifier` — the FIXED Apple Pass Type ID (invisible client, ADR 0003).
 *  - `deviceLibraryIdentifier` — Apple's opaque per-device id (NOT the push token).
 *  - `pushToken` — the APNs push token addressed when pushing an update (slice D).
 *  - `status` — `active` while the device should receive pushes, `inactive` after a
 *    `DELETE` (soft, never a hard delete — the registration history is auditable).
 *
 * The couple `(deviceLibraryIdentifier, serialNumber)` is UNIQUE (enforced
 * applicatively on `by_device_serial`, same convention as
 * `walletPasses.by_serial`): a re-`POST` of the same couple is IDEMPOTENT (it
 * refreshes the push token + re-activates, never duplicates the row).
 *
 * ── Does NOT capture identity nor push (slices C / D) ──────────────────────────
 * This slice lays the device-registration plumbing ONLY. The serial→customer
 * identity bridge (`customers.pushEnrollment.walletSerialNumber`, ADR 0008/0012) is
 * slice C; the actual APNs push over these tokens is slice D. This table stores the
 * push TOKEN, never sends to it here.
 */
export const walletDeviceRegistrations = defineTable({
  // The pass the device registered for (FK-by-value → walletPasses.serialNumber).
  serialNumber: v.string(),

  // The FIXED Apple Pass Type ID (e.g. `pass.com.kitchen-boost.card`) — invisible
  // to the client, identical on every registration (ADR 0003). Stored per-row so a
  // future pass-type migration stays auditable, but it is a constant in V1.
  passTypeIdentifier: v.string(),

  // Apple's opaque per-device identifier (from the registration URL path). The
  // device key — NOT the push token, and NOT a customer identity.
  deviceLibraryIdentifier: v.string(),

  // The APNs push token the device handed over — the address a Wallet push update
  // is later sent to (slice D). Refreshed on an idempotent re-register.
  pushToken: v.string(),

  // `active` while the device should receive pushes; `inactive` after the device
  // unregistered (DELETE) — a SOFT flip, never a hard delete (ADR: history kept).
  status: v.union(v.literal("active"), v.literal("inactive")),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  // All registrations for a pass (push fan-out + the Web Service "serials changed").
  .index("by_serial", ["serialNumber"])
  // All registrations of a device (Web Service "list passes for a device").
  .index("by_device", ["deviceLibraryIdentifier"])
  // The UNIQUE (device, pass) couple — idempotent register / targeted unregister.
  .index("by_device_serial", ["deviceLibraryIdentifier", "serialNumber"]);
