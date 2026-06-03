import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * #393 (KB Orders, PRD 20 §1a / §1b / §12) — `devices`.
 *
 * Per-(user, device) preference row owned by the native app. Created the FIRST
 * time a `user` signs in on a `device` (Q20-Q post-grilling axe 2, PRD 20 §1a)
 * and persisted thereafter so subsequent launches skip the onboarding sequence.
 * Drives THREE things in KB Orders V1:
 *
 *  1. **`mode` = `kiosque` | `telephone`** (PRD 20 §1a step 3, §12) — the toggle
 *     « Cette tablette sera dédiée à la cuisine ? Oui / Non » shown at first
 *     login. The choice is NOT auto-detected by form factor (a manager may want
 *     a large phone in the kitchen or a tablet in mobility — PRD 20 §12), is
 *     re-modifiable from Settings (#418, TB-21 will wire the UI), and is the
 *     gate the switcher (#399), `expo-keep-awake` and beep-volume reading.
 *
 *  2. **`pinnedTenantId`** (PRD 20 §12, §1c audit monolithique V1) — set when
 *     `mode = kiosque`: the tenant becomes the IMPLICIT scope of every screen
 *     of the device, the tenant switcher is hidden (#399), and every audit row
 *     V1 attributes the action to the KB Manager whose session is open here.
 *     A `telephone` device carries NO pin (the switcher stays free) — the
 *     setter enforces that combination.
 *
 *  3. **`lastSelectedTenantId`** (PRD 20 §1b, #399) — the LAST tenant the user
 *     selected in `mode = telephone` (only meaningful for N-tenants users such
 *     as Walid). Hydrates the switcher default on re-launch. Distinct from the
 *     `pinnedTenantId` field, which is a HARD pin only in kiosque mode.
 *
 *  4. **`onboardingCompleted`** (PRD 20 §1a flag) — true once the post-login
 *     sequence (push prompt + kiosque toggle + device checklist) has been done
 *     on THIS device, so subsequent launches skip straight to home (§1a tail
 *     « séquence skip aux re-launches »).
 *
 * ── USER-SCOPED, NO `tenantId` SCOPING KEY — accessed via the SELF-IDENTITY seam
 * Unlike most 2.x tables (ADR 0010), this row is NOT a tenant resource: it is
 * per-(user, device). The sanctioned access seam is `devicesStore.ts` in the
 * exempt `convex/lib/tenancy/**` path (same convention as `customers` /
 * `prospects` for non-tenant-scoped tables). Business reads/writes go through
 * those helpers — never raw `ctx.db.query("devices")` (`no-untenanted-query`).
 *
 * `pinnedTenantId` carries a cross-tenant constraint that lives in the BUSINESS
 * layer (the `lib/devices` setter), not the table: a user may only pin to a
 * tenant they actually have an ACTIVE `userTenants` attachment on. The setter
 * resolves access via `getCurrentActor(tenantId)` and throws Forbidden otherwise
 * — this is what the cross-tenant fuzz pins.
 */

/** Device usage mode (PRD 20 §1a step 3, §12). */
export const deviceMode = v.union(v.literal("kiosque"), v.literal("telephone"));

export const devices = defineTable({
  // Owner identity.
  userId: v.id("users"),
  /**
   * Stable device-side identifier (uuid-style string, generated and persisted
   * by the native client in SecureStore — survives reinstalls only if the OS
   * keychain persists; otherwise a fresh row is created on next launch, which
   * is the intended behaviour). Opaque to the backend.
   */
  deviceId: v.string(),

  // Preferences.
  mode: deviceMode,
  pinnedTenantId: v.optional(v.id("tenants")),
  lastSelectedTenantId: v.optional(v.id("tenants")),
  onboardingCompleted: v.optional(v.boolean()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  // UNIQUE lookup key per (user, device). Upsert reads with `.unique()`.
  .index("by_user_device", ["userId", "deviceId"])
  // Reverse index: list every device of a user (Settings page, future #418).
  .index("by_user", ["userId"]);
