import type { Doc, Id } from "../../_generated/dataModel";
import { type QueryCtx, internalQuery } from "../../_generated/server";
import { kbAdminQuery, listAllTenants } from "../tenancy";

/**
 * Address-first slice 4 (2026-06-11) — audit existing already-`active` tenants
 * whose 4-tuple (`address` + `addressLat` + `addressLng` + `addressComponents`)
 * is incomplete. Slices 1-3 (PRs #484/#485/#486) ensure any NEW activation
 * requires the full 4-tuple:
 *
 *  - #484 (schema)            — the structured siblings landed as OPTIONAL on
 *                               `tenants` so legacy rows wouldn't break the
 *                               schema check; `tenant.updateSettings` enforces
 *                               all-or-nothing on every write
 *                               (`INVALID_ADDRESS_PAYLOAD`).
 *  - #485 (CoordonneesEditor) — wizard step 4 + Paramètres page surface a
 *                               Google Places-powered input that PERSISTS the
 *                               full 4-tuple at once.
 *  - #486 (activate gate)     — `tenant.activate` throws
 *                               `ACTIVATION_BLOCKED_NO_ADDRESS` when the
 *                               4-tuple isn't complete, so no fresh tenant
 *                               can go live without a Places-validated
 *                               address from now on.
 *
 * **This slice 4 surfaces the LEGACY tenants** that were activated BEFORE the
 * gate landed and that carry an incomplete 4-tuple. There is no migration-by-
 * code path possible: re-geocoding a free-text display string requires Google
 * Places (browser SDK only — `@googlemaps/js-api-loader` touches `window` and
 * blows up in Convex's V8 runtime, cf. memory `googlemaps-loader-ssr-bug`).
 * So we audit + track, and ops contacts the resto so a manager re-saves the
 * address via the new editor (which writes the full structured payload).
 *
 * ── Two callers ─────────────────────────────────────────────────────────────
 *  - `auditTenantsWithMissingAddress` — internalQuery (system-side, for cron
 *    / ops scripts, never exposed publicly).
 *  - `listTenantsWithMissingAddress` — `kbAdminQuery` (root-only), backs the
 *    « Tenants sans adresse configurée » section of the F-MONITORING dashboard.
 *
 * Both delegate to the PURE aggregator `findTenantsMissingAddress` (no DB,
 * no ctx — trivially unit-testable). Reads go through the sanctioned
 * `listAllTenants` tenancy seam (ADR 0010 / `no-untenanted-query`).
 */

// ---------------------------------------------------------------------------
// Row projection (pure type, no `v.object` validator — return-side only).
// ---------------------------------------------------------------------------

/**
 * The projection returned for one incomplete tenant. Carries everything the
 * monitoring UI needs to render a row + build a deep-link to the tenant's
 * paramètres page:
 *
 *  - `_id` / `slug` / `name` / `status` — identity + display.
 *  - `missingAddress` / `missingLat` / `missingLng` / `missingComponents`
 *    — per-field flags so the UI can highlight WHICH part is missing
 *    (a legacy display-string-only tenant has `missingAddress = false` but
 *    the three structured siblings are all true).
 *  - `createdAt` — surfaced so ops can prioritise older rows (the resto has
 *    been live without proper geocoding the longest).
 */
export type TenantMissingAddressRow = {
  _id: Id<"tenants">;
  slug: string;
  name: string;
  status: "active";
  missingAddress: boolean;
  missingLat: boolean;
  missingLng: boolean;
  missingComponents: boolean;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// PURE aggregator (no DB, no ctx).
// ---------------------------------------------------------------------------

/**
 * Given the full tenants list, return the subset of ACTIVE tenants whose
 * address 4-tuple is incomplete (at least one of `address` / `addressLat` /
 * `addressLng` / `addressComponents` is `undefined`). Sorted alphabetically by
 * `name` for stable UI order — the monitoring table consumer should not
 * jitter on every re-fetch because the underlying `_creationTime` order
 * changed.
 *
 * Pure: no DB, no ctx, no `Date.now()`. The caller hands a snapshot of every
 * tenant; we filter + project. Non-active tenants are filtered out (a
 * `pending` tenant is still in the wizard — slice 3 prevents activation;
 * a `suspended` / `disabled` tenant is out-of-service and not actionable
 * for this migration sweep).
 */
export function findTenantsMissingAddress(
  tenants: Doc<"tenants">[],
): TenantMissingAddressRow[] {
  const incomplete: TenantMissingAddressRow[] = [];
  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    const missingAddress = tenant.address === undefined;
    const missingLat = tenant.addressLat === undefined;
    const missingLng = tenant.addressLng === undefined;
    const missingComponents = tenant.addressComponents === undefined;
    if (!missingAddress && !missingLat && !missingLng && !missingComponents)
      continue;
    incomplete.push({
      _id: tenant._id,
      slug: tenant.slug,
      name: tenant.name,
      status: "active",
      missingAddress,
      missingLat,
      missingLng,
      missingComponents,
      createdAt: tenant.createdAt,
    });
  }
  return incomplete.slice().sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// System-side read (no actor) — shared by both Convex surfaces below.
// ---------------------------------------------------------------------------

async function readAudit(ctx: QueryCtx): Promise<TenantMissingAddressRow[]> {
  // Goes through the sanctioned tenancy seam (`no-untenanted-query`) — no raw
  // `ctx.db` here. `listAllTenants` is the same store call the KB Admin
  // `TenantSwitcher` consumes (ADR 0014 §7), and the caller chain has already
  // proven root access (every surface below is either `kbAdminQuery` or an
  // `internalQuery` that is never exposed publicly).
  const tenants = await listAllTenants(ctx);
  return findTenantsMissingAddress(tenants);
}

// ---------------------------------------------------------------------------
// Convex surfaces.
// ---------------------------------------------------------------------------

/**
 * Root-only public read backing the KB Admin monitoring « Tenants sans
 * adresse configurée » section. `kbAdminQuery` → every non-root actor is
 * refused with `FORBIDDEN` BEFORE the handler runs (root-only fuzz, ADR 0010).
 */
export const listTenantsWithMissingAddress = kbAdminQuery({
  args: {},
  handler: async (ctx): Promise<TenantMissingAddressRow[]> => readAudit(ctx),
});

/**
 * System-side audit read used by cron / ops scripts. Internal — never exposed
 * publicly; the actor-gated public read is `listTenantsWithMissingAddress`
 * above. Same projection, no actor.
 */
export const auditTenantsWithMissingAddress = internalQuery({
  args: {},
  handler: async (ctx): Promise<TenantMissingAddressRow[]> => readAudit(ctx),
});
