import { ConvexError, v } from "convex/values";
import {
  tenantMutation,
  updateTenantSettings as updateTenantSettingsStore,
} from "../tenancy";
import {
  assertNonEmptyString,
  isValidHexColor,
  normalisePhone,
} from "./tenantSettingsValidation";

/**
 * B-TENANT-LIFECYCLE [3/4] — `tenant.updateSettings` mutation (D5 élargi, PRD 70
 * §3.6 step 4 + §4.8), the SINGLE backend brick that lets BOTH the KB Admin
 * Wizard step 4 (Branding) AND the KB Manager "Paramètres tenant" page save
 * tenant settings via one call.
 *
 * Wrapper: `tenantMutation({ allow: ["kb_manager"], audit: true, action:
 * "tenant.updateSettings" })`. The `kb_admin` root override already wired in
 * `withTenant.ts` ("Root: unlimited access to every tenant, bypasses `allow`")
 * covers the wizard caller — ONE mutation, TWO callers; no separate root
 * surface. The wrapper auto-audits on success (composition inside the
 * wrapper, same transaction).
 *
 * Tenancy discipline (ADR 0010): no raw `ctx.db` in this business module
 * (`no-untenanted-query` enforces it). Persistence is delegated to
 * `updateTenantSettings` from the sanctioned `lib/tenancy/tenantsStore.ts`
 * seam, which owns the deep-merge logic for `branding` (so a
 * `{ branding: { logoUrl } }` patch does NOT erase a pre-existing
 * `primaryColor`).
 *
 * Validation pipeline reuses the PURE helpers from slice 2:
 *  - `branding.primaryColor` → `isValidHexColor` → throw `INVALID_HEX_COLOR`.
 *  - `branding.logoUrl`      → `assertNonEmptyString(_, "INVALID_LOGO_URL")`.
 *  - `address`               → `assertNonEmptyString(_, "INVALID_ADDRESS")`.
 *  - `phone`                 → `normalisePhone` (throws `INVALID_PHONE`).
 * Validation runs BEFORE the store call so a failed validation never
 * persists a partial change (transactional, single mutation).
 *
 * Convex registers this by module PATH, so callers invoke
 * `api.lib.admin.tenantSettings.updateSettings`. Re-exported from
 * `lib/admin/index.ts` following the contracts/monitoring pattern.
 *
 * Error codes the frontend can branch on:
 *  - `FORBIDDEN` / `UNAUTHENTICATED` (from the wrapper)
 *  - `INVALID_HEX_COLOR` / `INVALID_PHONE` / `INVALID_ADDRESS` /
 *    `INVALID_LOGO_URL` (from the validation pipeline)
 *  - `NOT_FOUND` is not surfaced here directly — a syntactically-valid but
 *    deleted `tenantId` is rejected by the wrapper's tenant-access check
 *    (no active row ⇒ `FORBIDDEN: no access to this tenant`).
 */

/** Optional branding sub-object the wizard / Paramètres form patches. */
const brandingPatch = v.object({
  logoUrl: v.optional(v.string()),
  primaryColor: v.optional(v.string()),
});

/** Optional accepted-modes toggle (delivery vs click & collect). */
const acceptedModesPatch = v.object({
  delivery: v.boolean(),
  clickAndCollect: v.boolean(),
});

/**
 * The settings-side patch. Every field is OPTIONAL — callers may patch any
 * subset. `branding` is deep-merged in the store; the other top-level fields
 * are shallow-merged via `ctx.db.patch` semantics. An empty patch is a no-op.
 */
const settingsPatch = v.object({
  branding: v.optional(brandingPatch),
  address: v.optional(v.string()),
  phone: v.optional(v.string()),
  acceptedModes: v.optional(acceptedModesPatch),
});

export const updateSettings = tenantMutation({ allow: ["kb_manager"] })({
  args: { patch: settingsPatch },
  audit: true,
  action: "tenant.updateSettings",
  handler: async (ctx, args): Promise<void> => {
    const { patch } = args;

    // ── Validation (runs BEFORE the store call so a refused patch never
    //    persists a partial change — transactional, single mutation). ─────────
    const normalised: {
      branding?: { logoUrl?: string; primaryColor?: string };
      address?: string;
      phone?: string;
      acceptedModes?: { delivery: boolean; clickAndCollect: boolean };
    } = {};

    if (patch.branding !== undefined) {
      const branding: { logoUrl?: string; primaryColor?: string } = {};
      if (patch.branding.primaryColor !== undefined) {
        if (!isValidHexColor(patch.branding.primaryColor)) {
          throw new ConvexError({
            code: "INVALID_HEX_COLOR",
            message: `Primary color "${patch.branding.primaryColor}" is not a canonical 6-digit hex (e.g. #1B7A3D).`,
          });
        }
        branding.primaryColor = patch.branding.primaryColor;
      }
      if (patch.branding.logoUrl !== undefined) {
        branding.logoUrl = assertNonEmptyString(
          patch.branding.logoUrl,
          "INVALID_LOGO_URL",
        );
      }
      normalised.branding = branding;
    }

    if (patch.address !== undefined) {
      normalised.address = assertNonEmptyString(
        patch.address,
        "INVALID_ADDRESS",
      );
    }

    if (patch.phone !== undefined) {
      normalised.phone = normalisePhone(patch.phone);
    }

    if (patch.acceptedModes !== undefined) {
      normalised.acceptedModes = patch.acceptedModes;
    }

    // ── Persistence — delegate to the sanctioned store seam (deep-merge on
    //    branding lives there). Empty patch ⇒ store no-op. ───────────────────
    await updateTenantSettingsStore(ctx, ctx.tenantId, normalised);
  },
});
