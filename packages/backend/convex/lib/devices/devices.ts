import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { type Actor, getCurrentActor } from "../auth";
import { type DeviceMode, getUserDevice, upsertUserDevice } from "../tenancy";
import { deviceMode } from "../../table/devices";

/**
 * #393 — `devices` business module (PRD 20 §1a / §1b / §12).
 *
 * Self-scoped per-(user, device) preference seam the native app calls at first
 * login (toggle kiosque/téléphone) and at every re-launch (skip onboarding +
 * hydrate switcher / pin). The kiosque pin is the gate of three V1 behaviours:
 * tenant switcher hidden (#399), `expo-keep-awake` + max-volume beep, audit
 * monolithique V1 (every action attributed to the KB Manager of the session
 * open on the device, PRD 20 §1c).
 *
 * Why NOT a `tenantQuery` / `tenantMutation` here:
 *
 *  - The row is owned by a USER, not a tenant — every read/write targets the
 *    caller's OWN `(userId, deviceId)`. There is no `tenantId` scoping key on
 *    the table (cf. `convex/table/devices.ts` header).
 *  - The cross-tenant constraint on `pinnedTenantId` (the user must have an
 *    ACTIVE `userTenants` attachment on the pinned tenant) is enforced HERE
 *    via `getCurrentActor(pinnedTenantId)` — resolving `effectiveRole` IS the
 *    access check (kb_manager / staff = OK, `null` = no attachment = throw
 *    Forbidden; kb_admin always passes via root override). Same convention as
 *    `tenantMutation`, just called inline because the wrappers expect a
 *    `tenantId` ARG and our handlers may have NO tenant at all (telephone
 *    mode, fresh device).
 *
 * ADR 0011: this module uses ONLY `getCurrentActor` to resolve identity —
 * never `getAuthUserId`. The single sanctioned `ctx.db` site for the table
 * lives in `lib/tenancy/devicesStore.ts`; this module never touches raw
 * `ctx.db` (`no-untenanted-query`).
 */

const forbidden = (message: string) =>
  new ConvexError({ code: "FORBIDDEN", message: `Forbidden: ${message}` });

const unauthenticated = () =>
  new ConvexError({ code: "UNAUTHENTICATED", message: "Unauthenticated" });

const invalid = (message: string) =>
  new ConvexError({ code: "INVALID_ARGUMENT", message });

/**
 * Resolve the current `Actor` (throws Unauthenticated) AND assert it has
 * access to `tenantId` (throws Forbidden when `effectiveRole === null`).
 * Mirrors `tenantQuery`'s gate inline because this module's mutations may
 * have NO tenant at all (telephone mode, fresh device) — we cannot wrap
 * the whole handler. `kb_admin` is the root override and always passes.
 */
async function requireActorWithTenantAccess(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Actor> {
  const actor = await getCurrentActor(ctx, tenantId);
  if (actor === null) throw unauthenticated();
  if (actor.effectiveRole === null) {
    throw forbidden("no access to this tenant");
  }
  return actor;
}

/**
 * `getMyDevice` — read the caller's row for `deviceId`. Returns `null` when no
 * row exists yet (first launch — the native app uses that to decide whether
 * to show the kiosque/téléphone toggle, PRD 20 §1a). Self-scoped by
 * construction (the index lookup keys on `actor.userId`).
 */
export const getMyDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getCurrentActor(ctx);
    if (actor === null) throw unauthenticated();
    return getUserDevice(ctx, actor.userId, args.deviceId);
  },
});

/**
 * `setMyDeviceMode` — UPSERT the caller's `(userId, deviceId)` row with the
 * chosen mode (and a pin when entering kiosque). Drives the FIRST-launch
 * choice + every later Settings rebascule (#418 / TB-21).
 *
 * Invariants enforced HERE (the cross-tenant fuzz pins them):
 *
 *  - `mode = kiosque` REQUIRES `pinnedTenantId` AND the caller must have an
 *    ACTIVE access to that tenant. Otherwise we'd silently anchor the device
 *    to a tenant the user can't see — leaking through #399's switcher logic.
 *  - `mode = telephone` REJECTS `pinnedTenantId` (the switcher must stay free).
 *    Re-bascule kiosque → téléphone CLEARS the existing pin in one atomic
 *    write (PRD 20 §12 « Toggle re-modifiable depuis Settings »).
 */
export const setMyDeviceMode = mutation({
  args: {
    deviceId: v.string(),
    mode: deviceMode,
    pinnedTenantId: v.optional(v.id("tenants")),
  },
  handler: async (ctx, args) => {
    // Identity FIRST (ADR 0011, single sanctioned call site).
    const actor = await getCurrentActor(ctx);
    if (actor === null) throw unauthenticated();

    // Invariant: mode ↔ pin combination is exclusive.
    if (args.mode === "kiosque" && args.pinnedTenantId === undefined) {
      throw invalid(
        "pinnedTenantId is required when mode is 'kiosque' (PRD 20 §12)",
      );
    }
    if (args.mode === "telephone" && args.pinnedTenantId !== undefined) {
      throw invalid(
        "pinnedTenantId must be absent when mode is 'telephone' (PRD 20 §1b)",
      );
    }

    // Cross-tenant access guardrail: resolve effective role on the pinned
    // tenant via the SINGLE sanctioned identity point. `kb_admin` passes via
    // the root override; any other caller must have an ACTIVE userTenants
    // attachment.
    if (args.pinnedTenantId !== undefined) {
      await requireActorWithTenantAccess(ctx, args.pinnedTenantId);
    }

    // Persist via the sanctioned seam. `mode = telephone` MUST clear any
    // existing pin (re-bascule kiosque → téléphone, PRD 20 §12 / TB-21).
    const mode: DeviceMode = args.mode;
    await upsertUserDevice(ctx, actor.userId, args.deviceId, {
      mode,
      pinnedTenantId: mode === "kiosque" ? args.pinnedTenantId : null,
    });
    return null;
  },
});

/**
 * `setMyDeviceLastSelectedTenant` — record the LAST tenant the (phone-mode)
 * caller selected in the header switcher (#399). Persisted across re-launches
 * so the switcher reopens on the same tenant by default.
 *
 * Cross-tenant guardrail: same as the pin — the user must have an active
 * attachment on that tenant (a malicious / stale client cannot anchor a
 * device to a tenant the caller no longer sees).
 */
export const setMyDeviceLastSelectedTenant = mutation({
  args: { deviceId: v.string(), tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const actor = await requireActorWithTenantAccess(ctx, args.tenantId);
    await upsertUserDevice(ctx, actor.userId, args.deviceId, {
      lastSelectedTenantId: args.tenantId,
    });
    return null;
  },
});

/**
 * `markOnboardingCompleted` — flip the per-(user, device) skip flag once the
 * post-login sequence (push prompt + kiosque toggle + device checklist) has
 * been done. `_layout.tsx` reads it via `getMyDevice` to decide whether to
 * mount the onboarding route (PRD 20 §1a « séquence skip aux re-launches »).
 */
export const markOnboardingCompleted = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getCurrentActor(ctx);
    if (actor === null) throw unauthenticated();
    await upsertUserDevice(ctx, actor.userId, args.deviceId, {
      onboardingCompleted: true,
    });
    return null;
  },
});
