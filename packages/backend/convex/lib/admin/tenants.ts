/**
 * Root-scoped queries for the `tenants` core table. Consumed by the shell
 * `TenantSwitcher` (ADR 0014 §7 + issue #208) so a KB Admin can switch into
 * any tenant from anywhere.
 *
 * The `apps/admin` tenant-switcher.tsx originally shipped a stub-fallback
 * (`api.table.tenants.listAllTenants`-probe-or-skip) waiting for this backend
 * query to land. The stub broke at runtime because `useQuery(undefined,
 * "skip")` throws before the fallback's `return undefined` could fire. This
 * module is the missing backend dependency that turns the stub into a real
 * query.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  getTenantById,
  kbAdminQuery,
  listAllTenants as listAllTenantsFromStore,
} from "../tenancy";

/**
 * Tenant lifecycle status — mirrors `tenantStatus` (`convex/table/tenants.ts`).
 * Kept as a plain TS union here (no `v.union` re-import) because this is the
 * RETURN-side projection, not a validator. The single source of truth is the
 * `tenantStatus` validator in the table definition.
 */
export type TenantPanelStatus = "active" | "pending" | "suspended" | "disabled";

/**
 * Minimal projection returned by `getTenant` (issue #264). Uses `_id` (not
 * `tenantId`) so a full `Doc<"tenants">` is structurally assignable to this
 * shape — the existing pre-264 callers (`prospect-fiche-view.test.tsx`)
 * that pass a fixture `Doc<"tenants">` to `tenant?:` keep working.
 */
export type TenantPanelProjection = {
  _id: Id<"tenants">;
  slug: string;
  name: string;
  status: TenantPanelStatus;
};

/**
 * List every tenant in the DB for the root combobox. Optional `search` filters
 * case-insensitively on `slug` + `name`.
 *
 * V1 keeps the search work in-memory (post-fetch): the tenant catalog is small
 * (a few dozen restos at most in the foreseeable months, PRD 70). When that
 * stops being true, swap the underlying store helper for an indexed paginated
 * scan — the API shape here is stable.
 *
 * Returns a minimal projection (`tenantId`, `slug`, `name`) — never the full
 * `Doc<"tenants">`. The switcher only needs these three fields, and exposing
 * less is safer (no Stripe ids / SIRET leaked through a future client logger).
 */
export const listAllTenants = kbAdminQuery({
  args: { search: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ tenantId: Id<"tenants">; slug: string; name: string }>
  > => {
    if (typeof args.search === "string" && args.search.length > 200) {
      // Defensive: a malformed/forged call shouldn't be allowed to push a
      // huge string through the filter loop. Generous bound — the input is
      // a combobox typeahead, never a real query language.
      throw new ConvexError({ message: "Search string too long" });
    }
    const rows = await listAllTenantsFromStore(ctx);
    const needle =
      typeof args.search === "string" && args.search.trim() !== ""
        ? args.search.trim().toLowerCase()
        : null;
    const filtered = needle
      ? rows.filter(
          (t) =>
            t.slug.toLowerCase().includes(needle) ||
            t.name.toLowerCase().includes(needle),
        )
      : rows;
    // Stable alpha-by-name order — the combobox should not jitter on every
    // re-fetch because the underlying `_creationTime` order changes.
    return filtered
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ tenantId: t._id, slug: t.slug, name: t.name }));
  },
});

/**
 * F-PIPELINE-CRM 09 (#264) — root-only single-tenant projection used by the
 * supervision fiche's `TenantPanel` to surface the back-link of a provisioned
 * tenant (`prospect.tenantId`).
 *
 * Returns a MINIMAL projection (`tenantId / slug / name / status`) — never the
 * full `Doc<"tenants">`. Same exposure discipline as `listAllTenants` (no
 * Stripe ids, no SIRET leaked through a future client logger). A
 * syntactically-valid id with no row maps to `null` so the front can branch
 * the « Tenant introuvable » degraded UX cleanly (tri-state convention).
 *
 * Persistence is delegated to the sanctioned `lib/tenancy/tenantsStore.ts`
 * seam (`getTenantById`) — no raw `ctx.db` here (ADR 0010 /
 * `no-untenanted-query`). Wrapper: `kbAdminQuery` — every non-root actor
 * (`kb_manager`, `staff`, `customer`, anonymous) is refused by the wrapper
 * BEFORE the handler runs (root-only fuzz, ADR 0010).
 */
export const getTenant = kbAdminQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<TenantPanelProjection | null> => {
    const row = await getTenantById(ctx, args.tenantId);
    if (row === null) return null;
    return {
      _id: row._id,
      slug: row.slug,
      name: row.name,
      status: row.status,
    };
  },
});
