/**
 * Session types — the front-side contract of `getSession` (backend D1, story
 * #162). Kept in admin/src so this F-SHELL story can land before the backend
 * query exists; when #162 merges, only the loader's call signature changes,
 * not these types or the hook consumers.
 *
 * Shape mandated by ADR 0014 §3 + PRD 70 D1:
 *   { isAdmin, tenants: [{ tenantId, slug, name, role }] }
 *
 * NOTE on `tenantId`: typed as `Id<"tenants">` (Convex branded id) so that
 * downstream consumers (URL builders, `useTenantQuery`) get the exact same
 * branded type they'd get from `useQuery(api.auth.getSession)` once #162
 * ships. Re-uses the generated `dataModel` types — no fabricated branding.
 */
import type { Id } from "@packages/backend/convex/_generated/dataModel";

/** Per-tenant entry returned by `getSession` (one row of `userTenants` joined
 * with the tenant's display fields). `role` mirrors the resto-scoped role
 * carried per-tenant (ADR 0011). */
export type SessionTenant = {
  tenantId: Id<"tenants">;
  slug: string;
  name: string;
  role: "kb_manager" | "staff";
};

/** Minimal user projection used by the shell's NavUser footer (replaces the
 * old `api.table.admin.currentAdmin` which was scoped to `role === "kb_admin"`
 * only — a manager would receive `null` and the footer would render blank).
 * Every field bar `userId` is optional because the Convex Auth `users` row
 * baseline doesn't guarantee any of them (a freshly signed-up account may
 * carry only `email`). */
export type SessionUser = {
  userId: Id<"users">;
  name?: string;
  email?: string;
  image?: string;
};

/** Raw data shape returned by the future `api.auth.getSession` query. */
export type SessionData = {
  isAdmin: boolean;
  tenants: SessionTenant[];
  user: SessionUser;
};

/** Tri-state machine of the session as observed by the front. */
export type SessionStatus = "loading" | "unauthenticated" | "ready";

/** Discriminated union surfaced by `useSession()`. */
export type SessionState =
  | { status: "loading"; session?: undefined }
  | { status: "unauthenticated"; session?: undefined }
  | { status: "ready"; session: SessionData };
