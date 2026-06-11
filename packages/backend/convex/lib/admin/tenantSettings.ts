import { ConvexError, v } from "convex/values";
import { readTenantCredentialBlob } from "../crypto";
import {
  activateTenant,
  getTenantById,
  kbAdminMutation,
  logAudit,
  tenantMutation,
  tenantQuery,
  updateTenantSettings as updateTenantSettingsStore,
} from "../tenancy";
import { assertLegalTenantTransition } from "./tenantLifecycle";
import {
  assertNonEmptyString,
  isValidAddressPayload,
  isValidCustomDomain,
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
 *
 * F-WIZARD [4/10] (#268) — `customDomain` is exposed on this very surface so
 * the wizard's step 2 form (« domaine personnalisé optionnel », modèle
 * Owner.com) reuses the SAME mutation. Validated via `isValidCustomDomain`
 * with the SAME regex the front uses (`^[a-z0-9.-]+\.[a-z]{2,}$`) — single
 * source of validation shape, no FE/BE drift. Throws `INVALID_CUSTOM_DOMAIN`
 * on a bad shape.
 */
/**
 * Address-first slice 1 (2026-06-11) — the structured `addressComponents`
 * sub-object the wizard / Paramètres editor (slice 2 frontend, Google Places)
 * persists ALONGSIDE the display `address` + lat/lng. Same V1 FR-only shape as
 * `tenants.addressComponents`.
 */
const addressComponentsPatch = v.object({
  streetAddress: v.string(),
  city: v.string(),
  zipCode: v.string(),
  country: v.string(),
});

const settingsPatch = v.object({
  branding: v.optional(brandingPatch),
  address: v.optional(v.string()),
  // Address-first slice 1 (2026-06-11) — the structured siblings of `address`.
  // The 4-tuple TRAVELS TOGETHER on every patch (enforced in the handler via
  // `isValidAddressPayload`).
  addressLat: v.optional(v.number()),
  addressLng: v.optional(v.number()),
  addressComponents: v.optional(addressComponentsPatch),
  phone: v.optional(v.string()),
  acceptedModes: v.optional(acceptedModesPatch),
  customDomain: v.optional(v.string()),
});

/**
 * Read counterpart of `updateSettings` — the SINGLE KB Manager-accessible
 * read of the persisted settings sub-object (`branding` + `address` + `phone`
 * + `acceptedModes` + `customDomain`).
 *
 * Background fix (2026-06-01, P1 E2E spot-check, [docs/tests/E2E-checklist.md](../../../../../docs/tests/E2E-checklist.md)
 * groupe P) — until this query landed, the Paramètres page had NO manager-
 * accessible read for the values it lets the manager edit: the page header
 * explicitly noted « *No KB-Manager-accessible read query exists for `branding`
 * today (a follow-up slice will expose one)* » and seeded the editor with
 * `undefined`, so a successful save was invisible to the manager (no read =
 * no Convex reactivity = no refresh; the value was persisted in the DB but
 * the form snapped back to defaults on reload). This query IS that follow-up.
 *
 * Wrapper: `tenantQuery({ allow: ["kb_manager"] })`. The kb_admin root
 * override (cf. `withTenant.ts`) covers the admin caller for free — ONE
 * query, TWO callers, no separate root surface (mirrors `updateSettings`).
 *
 * Returns ONLY the settings fields the Paramètres / Wizard editors care
 * about — NOT the whole `Doc<"tenants">` row (which carries Stripe ids,
 * Uber customer ids, operational pause, audit timestamps, etc. that have
 * no business landing on a manager-side payload). Each field is `undefined`
 * when not yet set (a fresh tenant has none of these); the editors handle
 * `undefined` gracefully (seeds empty inputs / brand-default color).
 *
 * Tenancy discipline (ADR 0010): no raw `ctx.db` — reads through the
 * sanctioned `lib/tenancy/tenantsStore.getTenantById` seam (same shape as
 * the rest of the file). `ctx.tenantId` is auto-injected by the wrapper from
 * the session, so a manager cannot forge an `args.tenantId` for a different
 * resto (cross-tenant MOAT, ADR 0010).
 *
 * Error codes:
 *  - `FORBIDDEN` / `UNAUTHENTICATED` (wrapper)
 *  - `NOT_FOUND` — syntactically valid `tenantId` but no row (the wrapper
 *    already refuses Forbidden on an unrecognised tenant for a manager;
 *    the explicit check here covers an internal race where the row was
 *    deleted between the wrapper's membership check and this read).
 */
/**
 * Stripe Connect a posteriori (apps/admin `/t/[tenantId]/parametres/stripe`)
 * — manager-accessible read of the tenant's Stripe Connect Express state.
 *
 * Mirror discipline of `getSettings` above: ONE query, BOTH callers
 * (kb_manager + kb_admin via the root override on `tenantQuery`, see
 * `withTenant.ts`). Replaces the need for a dedicated root surface and
 * keeps the Paramètres page reachable by the resto's own gérant —
 * primary use case per the « a posteriori » spec (a manager configuring
 * their own Stripe).
 *
 * Returns ONLY the four fields the Stripe Settings card cares about —
 * `stripeAccountId` (acct_xxx, optional), `stripeStatus` (PRD 30 §2,
 * optional), `siret` (for the action's prefill), `name` (header). NEVER
 * leaks unrelated tenant fields (Uber customer id, printer config, audit
 * timestamps, etc.) — same exposure discipline as `listAllTenants` /
 * `getTenant` / `getSettings`.
 *
 * The action that consumes `stripeAccountId` (`api.lib.stripe.account
 * .createStripeAccountLink`) remains root-only. A kb_manager calling
 * « Générer » will see a Forbidden surfaced inline — the page documents
 * this degradation (admin support can step in via tenant switcher). The
 * KYC `account_link` URL can also be opened by the manager themselves
 * once the admin shares it.
 *
 * Tenancy discipline (ADR 0010): no raw `ctx.db` — reads through the
 * sanctioned `getTenantById` seam. `ctx.tenantId` is auto-injected by
 * the wrapper from the session, so a manager cannot forge an `args
 * .tenantId` for a different resto (cross-tenant MOAT).
 */
export const getStripeState = tenantQuery({ allow: ["kb_manager"] })({
  args: {},
  returns: v.object({
    stripeAccountId: v.union(v.null(), v.string()),
    stripeStatus: v.union(
      v.null(),
      v.literal("pending"),
      v.literal("ready"),
      v.literal("disabled"),
    ),
    siret: v.string(),
    name: v.string(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    stripeAccountId: string | null;
    stripeStatus: "pending" | "ready" | "disabled" | null;
    siret: string;
    name: string;
  }> => {
    const tenant = await getTenantById(ctx, ctx.tenantId);
    if (tenant === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tenant not found.",
      });
    }
    return {
      stripeAccountId: tenant.stripeAccountId ?? null,
      stripeStatus: tenant.stripeStatus ?? null,
      siret: tenant.siret,
      name: tenant.name,
    };
  },
});

/**
 * Uber Direct a posteriori (apps/admin `/t/[tenantId]/parametres/uber-direct`)
 * — manager-accessible read of the tenant's Uber Direct configuration state.
 *
 * Mirror discipline of `getStripeState` : ONE query, BOTH callers (kb_manager
 * + kb_admin via root override on `tenantQuery`, see `withTenant.ts`).
 *
 * Returns ONLY the three facts the Uber Direct Settings card cares about :
 * `uberCustomerId` (the sub-account id, optional — also exposed as a
 * non-secret on `tenants.uberCustomerId` so it's not a leak), `isConfigured`
 * (true iff a `tenantCredentials.uber_direct` envelope exists ⇒ creds were
 * saved at some point), `name` (header). NEVER returns the encrypted blob
 * itself — exposure discipline same as `getStripeState`, secrets stay
 * server-side (the action probing them is root-only).
 *
 * Why `isConfigured` is a boolean and not `null | "configured" | "validated"`:
 * the « validated » judgment lives in `probeUberAccount` (live API call, not
 * stored). The UI surfaces probe results separately so the badge stays a
 * simple « configured yes/no » + the live probe result.
 *
 * Tenancy discipline (ADR 0010) : `readTenantCredentialBlob` is the sanctioned
 * seam ; `ctx.tenantId` is auto-injected by the wrapper, so a manager cannot
 * forge an `args.tenantId` for a different resto (cross-tenant MOAT).
 */
export const getUberState = tenantQuery({ allow: ["kb_manager"] })({
  args: {},
  returns: v.object({
    uberCustomerId: v.union(v.null(), v.string()),
    isConfigured: v.boolean(),
    name: v.string(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    uberCustomerId: string | null;
    isConfigured: boolean;
    name: string;
  }> => {
    const tenant = await getTenantById(ctx, ctx.tenantId);
    if (tenant === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tenant not found.",
      });
    }
    const blob = await readTenantCredentialBlob(
      ctx,
      ctx.tenantId,
      "uber_direct",
    );
    return {
      uberCustomerId: tenant.uberCustomerId ?? null,
      isConfigured: blob !== null,
      name: tenant.name,
    };
  },
});

export const getSettings = tenantQuery({ allow: ["kb_manager"] })({
  args: {},
  returns: v.object({
    branding: v.union(
      v.null(),
      v.object({
        logoUrl: v.optional(v.string()),
        primaryColor: v.optional(v.string()),
      }),
    ),
    address: v.union(v.null(), v.string()),
    phone: v.union(v.null(), v.string()),
    acceptedModes: v.union(
      v.null(),
      v.object({
        delivery: v.boolean(),
        clickAndCollect: v.boolean(),
      }),
    ),
    customDomain: v.union(v.null(), v.string()),
  }),
  handler: async (
    ctx,
  ): Promise<{
    branding: { logoUrl?: string; primaryColor?: string } | null;
    address: string | null;
    phone: string | null;
    acceptedModes: { delivery: boolean; clickAndCollect: boolean } | null;
    customDomain: string | null;
  }> => {
    const tenant = await getTenantById(ctx, ctx.tenantId);
    if (tenant === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tenant not found.",
      });
    }
    return {
      branding: tenant.branding ?? null,
      address: tenant.address ?? null,
      phone: tenant.phone ?? null,
      acceptedModes: tenant.acceptedModes ?? null,
      customDomain: tenant.customDomain ?? null,
    };
  },
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
      addressLat?: number;
      addressLng?: number;
      addressComponents?: {
        streetAddress: string;
        city: string;
        zipCode: string;
        country: string;
      };
      phone?: string;
      acceptedModes?: { delivery: boolean; clickAndCollect: boolean };
      customDomain?: string;
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

    // Address-first slice 1 (2026-06-11) — the 4-tuple all-or-nothing rule.
    // The display string AND the structured siblings (lat/lng/components)
    // TRAVEL TOGETHER. A patch carrying any of them MUST carry all of them, OR
    // the call fails with `INVALID_ADDRESS_PAYLOAD` (no demi-patch). This
    // matches the Uber-recommended pickup_address shape (cf.
    // `lib/uberDirect/quote.ts`) and prevents the inconsistent-row state
    // exposed by the 1st PWA E2E run (commit 69699b3).
    //
    // A patch with NONE of the four leaves the address fields untouched.
    const addressTouched = [
      patch.address,
      patch.addressLat,
      patch.addressLng,
      patch.addressComponents,
    ].some((v) => v !== undefined);
    if (addressTouched) {
      if (
        patch.address === undefined ||
        patch.addressLat === undefined ||
        patch.addressLng === undefined ||
        patch.addressComponents === undefined
      ) {
        throw new ConvexError({
          code: "INVALID_ADDRESS_PAYLOAD",
          message:
            "Address patch must carry the full 4-tuple (address + addressLat + addressLng + addressComponents).",
        });
      }
      isValidAddressPayload({
        address: patch.address,
        addressLat: patch.addressLat,
        addressLng: patch.addressLng,
        addressComponents: patch.addressComponents,
      });
      normalised.address = patch.address;
      normalised.addressLat = patch.addressLat;
      normalised.addressLng = patch.addressLng;
      normalised.addressComponents = patch.addressComponents;
    }

    if (patch.phone !== undefined) {
      normalised.phone = normalisePhone(patch.phone);
    }

    if (patch.acceptedModes !== undefined) {
      normalised.acceptedModes = patch.acceptedModes;
    }

    // F-WIZARD [4/10] (#268) — `customDomain` (optional, modèle Owner.com).
    // Trim first (the wizard form already lowercases + trims on submit, but
    // the backend re-trims defensively — the only normalisation; the regex
    // shape check is otherwise pure). Reject empty / whitespace-only OR a
    // value that doesn't match the FQDN regex with `INVALID_CUSTOM_DOMAIN`.
    if (patch.customDomain !== undefined) {
      const trimmed = patch.customDomain.trim();
      if (!isValidCustomDomain(trimmed)) {
        throw new ConvexError({
          code: "INVALID_CUSTOM_DOMAIN",
          message: `Custom domain "${patch.customDomain}" is not a valid FQDN (expected pattern: ^[a-z0-9.-]+\\.[a-z]{2,}$, e.g. commander.le-petit-bistrot.fr).`,
        });
      }
      normalised.customDomain = trimmed;
    }

    // ── Persistence — delegate to the sanctioned store seam (deep-merge on
    //    branding lives there). Empty patch ⇒ store no-op. ───────────────────
    await updateTenantSettingsStore(ctx, ctx.tenantId, normalised);
  },
});

/**
 * B-TENANT-LIFECYCLE [4/4] — `tenant.activate` mutation (D6, PRD 70 §3.6 step 8),
 * the backend brick that lets the KB Admin Wizard step 8 ("Activer") flip a
 * freshly-provisioned tenant from `pending` to `active`, opening the PWA to
 * customers.
 *
 * Wrapper: `kbAdminMutation({ action: "tenant.activate" })`. Activation is a
 * KB-internal ops act, never delegated to a KB Manager — root-only (a
 * `kb_manager` / `staff` / `customer` is refused Forbidden by the wrapper). The
 * tenant id is passed as a regular handler arg (the kb_admin wrapper does NOT
 * consume `tenantId`); the cross-tenant fuzz still verifies role enforcement.
 *
 * Transition guard: only `pending → active` is legal in V1. Defers to
 * `assertLegalTenantTransition` from slice 2 — any other source status
 * (`active`, `suspended`, `disabled`) throws `INVALID_STATE`. V2 will widen by
 * editing the transitions map only (e.g. `pending → suspended`, `suspended →
 * active`); the mutation needs no change.
 *
 * Idempotence: NON-IDEMPOTENT V1. Calling `activate` twice on an
 * already-`active` tenant throws `INVALID_STATE` (consistent with the
 * contracts lifecycle; the front checks status before calling). V2 can relax.
 *
 * Audit — DOUBLE LAYER (mirrors `provisionTenant` in
 * `lib/onboarding/provisioning.ts`):
 *  - the wrapper auto-logs the root mutation (every `kbAdminMutation` is
 *    audited);
 *  - the handler emits an EXPLICIT richer `logAudit` carrying
 *    `metadata: { fromStatus: <previous status> }` — lifecycle transitions
 *    deserve extra metadata for ops reconstruction.
 *
 * Persistence is delegated to the sanctioned `lib/tenancy/tenantsStore` seam
 * (`getTenantById` + `activateTenant`) — no raw `ctx.db` in this business
 * module (ADR 0010, `no-untenanted-query`).
 *
 * Error codes the frontend can branch on:
 *  - `FORBIDDEN` / `UNAUTHENTICATED` (from the wrapper)
 *  - `NOT_FOUND` (tenant id syntactically valid but no row)
 *  - `ACTIVATION_BLOCKED_NO_ADDRESS` (address-first slice 3) — the tenant is
 *    missing the FULL 4-tuple `address` + `addressLat` + `addressLng` +
 *    `addressComponents`. Runs BEFORE the lifecycle gate so the operator
 *    sees the actionable error first (fix the address via wizard step 4 or
 *    the Paramètres editor, retry).
 *  - `INVALID_STATE` (source status is not `pending`)
 *
 * Convex registers this by module PATH, so callers invoke
 * `api.lib.admin.tenantSettings.activate`. Re-exported from
 * `lib/admin/index.ts` following the `updateSettings` / contracts /
 * monitoring pattern.
 */
export const activate = kbAdminMutation({
  args: { tenantId: v.id("tenants") },
  action: "tenant.activate",
  handler: async (ctx, args): Promise<void> => {
    // 1. Read the current tenant via the sanctioned seam. A syntactically
    //    valid but absent id maps to NOT_FOUND (the wrapper has no tenant
    //    membership concept for root mutations).
    const current = await getTenantById(ctx, args.tenantId);
    if (current === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tenant not found.",
      });
    }

    // 2. Address-first slice 3 (2026-06-11) — REQUIRE the FULL 4-tuple address
    //    payload BEFORE the lifecycle gate. A tenant can NOT be activated
    //    without a Places-validated address (display string + lat/lng + 4
    //    structured components), because:
    //      - the PWA delivery quote chain (`lib/uberDirect/quote.ts`) refuses
    //        every order with `pickup_address` missing the structured body
    //        (slice 1 fix, PR #484);
    //      - Stripe / branding / menu / QR / manager checks BELOW only matter
    //        once the resto is reachable end-to-end. An unreachable resto must
    //        not flip to `active`.
    //    Runs BEFORE `assertLegalTenantTransition` so the operator sees the
    //    actionable error first (fix the address, retry; the transition error
    //    only ever surfaces once the address is fixed). The `INVALID_STATE`
    //    branch downstream still owns the V1 non-idempotence path (active →
    //    active on a complete-address tenant).
    if (
      current.address === undefined ||
      current.address.trim() === "" ||
      current.addressLat === undefined ||
      current.addressLng === undefined ||
      current.addressComponents === undefined
    ) {
      throw new ConvexError({
        code: "ACTIVATION_BLOCKED_NO_ADDRESS",
        message: "Adresse du restaurant requise pour l'activation.",
      });
    }

    // 3. Defer to the pure state machine — only `pending → active` legal V1.
    //    Any other source status (`active`, `suspended`, `disabled`) is
    //    rejected with INVALID_STATE; covers both the illegal-source case
    //    AND the V1 non-idempotence (active → active is illegal).
    assertLegalTenantTransition(current.status, "active");

    // 3. Flip the lifecycle via the sanctioned seam. The seam is intentionally
    //    dumb (no guard there) so V2's new transitions can reuse it as-is.
    await activateTenant(ctx, args.tenantId);

    // 4. Explicit richer audit row on top of the wrapper's auto root-mutation
    //    log — carries metadata.fromStatus for ops reconstruction (mirrors
    //    provisionTenant's tenant.provision row).
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: "tenant.activate",
      tenantId: args.tenantId,
      targetType: "tenant",
      targetId: args.tenantId,
      metadata: { fromStatus: current.status },
    });
  },
});
