import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Infer } from "convex/values";
import type { deviceMode } from "../../table/devices";

/**
 * #393 — the SANCTIONED self-scoped data-access seam for the `devices` table
 * (PRD 20 §1a / §12; cf. `convex/table/devices.ts` header).
 *
 * `devices` is NOT tenant-scoped (per-(user, device) preference), but the same
 * isolation discipline applies (ADR 0010): business code reaches the table
 * ONLY through these helpers — never raw `ctx.db.query("devices")` (the
 * `no-untenanted-query` rule, 1.x-H, treats `convex/lib/tenancy/**` as the
 * single sanctioned `ctx.db` site for store seams). The cross-tenant
 * constraint on `pinnedTenantId` (the user must have an ACTIVE `userTenants`
 * attachment on the pinned tenant) is enforced in the BUSINESS layer
 * (`lib/devices/devices.ts`) via `getCurrentActor(tenantId)` — these helpers
 * only persist what the wrapper already gated.
 *
 * V1 = ONE row per `(userId, deviceId)`; `upsertUserDevice` is keyed on the
 * `by_user_device` UNIQUE index so the per-pair uniqueness is enforced
 * applicatively (no duplicate row on a re-call from the same device).
 */

export type DeviceMode = Infer<typeof deviceMode>;

/**
 * A partial patch applied at upsert time. `pinnedTenantId === null` MEANS
 * « clear the field » (e.g. when re-baselining from kiosque to telephone, the
 * pin must be wiped — PRD 20 §12); `undefined` MEANS « leave the existing
 * value alone ». Same convention for `lastSelectedTenantId` and
 * `onboardingCompleted`.
 */
export type DevicePatch = {
  mode?: DeviceMode;
  pinnedTenantId?: Id<"tenants"> | null;
  lastSelectedTenantId?: Id<"tenants"> | null;
  onboardingCompleted?: boolean;
  // #408 — toggle dispo item first-usage tooltip flag (PRD 20 §7c).
  itemToggleTooltipSeen?: boolean;
};

/** The (user, device) row, or `null` if none exists yet (first launch). */
export async function getUserDevice(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  deviceId: string,
): Promise<Doc<"devices"> | null> {
  return ctx.db
    .query("devices")
    .withIndex("by_user_device", (q) =>
      q.eq("userId", userId).eq("deviceId", deviceId),
    )
    .unique();
}

/**
 * UPSERT the (user, device) row with `patch`. Inserts on first call (defaults
 * `mode` to `telephone` if not supplied — the safer baseline, no pin), patches
 * on subsequent calls. Bumps `updatedAt`. A `null` value CLEARS the optional
 * field; an `undefined` value LEAVES IT alone.
 *
 * The caller (a guarded mutation in `lib/devices/devices.ts`) has ALREADY
 * resolved + gated the actor identity and the cross-tenant access to
 * `pinnedTenantId` / `lastSelectedTenantId`; this helper never re-checks.
 */
export async function upsertUserDevice(
  ctx: MutationCtx,
  userId: Id<"users">,
  deviceId: string,
  patch: DevicePatch,
): Promise<Id<"devices">> {
  const existing = await getUserDevice(ctx, userId, deviceId);
  const now = Date.now();

  if (existing === null) {
    // First-launch insert: mode is required (defaults to telephone — the
    // safest baseline, no pin, switcher remains free).
    const mode: DeviceMode = patch.mode ?? "telephone";
    return ctx.db.insert("devices", {
      userId,
      deviceId,
      mode,
      pinnedTenantId:
        patch.pinnedTenantId === null ? undefined : patch.pinnedTenantId,
      lastSelectedTenantId:
        patch.lastSelectedTenantId === null
          ? undefined
          : patch.lastSelectedTenantId,
      onboardingCompleted: patch.onboardingCompleted,
      itemToggleTooltipSeen: patch.itemToggleTooltipSeen,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Re-launch / re-bascule patch. `null` means "clear", `undefined` means
  // "leave alone" — Convex's `patch` itself does the latter for `undefined`,
  // we map our explicit `null` to `undefined` so the field is removed.
  const dbPatch: Record<string, unknown> = { updatedAt: now };
  if (patch.mode !== undefined) dbPatch.mode = patch.mode;
  if (patch.pinnedTenantId !== undefined)
    dbPatch.pinnedTenantId =
      patch.pinnedTenantId === null ? undefined : patch.pinnedTenantId;
  if (patch.lastSelectedTenantId !== undefined)
    dbPatch.lastSelectedTenantId =
      patch.lastSelectedTenantId === null
        ? undefined
        : patch.lastSelectedTenantId;
  if (patch.onboardingCompleted !== undefined)
    dbPatch.onboardingCompleted = patch.onboardingCompleted;
  if (patch.itemToggleTooltipSeen !== undefined)
    dbPatch.itemToggleTooltipSeen = patch.itemToggleTooltipSeen;

  await ctx.db.patch(existing._id, dbPatch);
  return existing._id;
}
