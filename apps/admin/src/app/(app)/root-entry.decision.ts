/**
 * F-SHELL-09 — root-entry redirect decision, pinned as a pure function.
 *
 * `apps/admin/src/app/(app)/page.tsx` is the URL `/` of the admin shell. It
 * is mounted under `(app)/layout.tsx` so by the time it renders the
 * `SessionGuard` has already admitted the actor (`isAdmin === true` OR
 * `tenants.length > 0`, ADR 0014 §3) — the no-tenant case is intercepted
 * upstream with `NoTenantEmptyState`. The page's only responsibility is
 * therefore to pick the right landing URL given (session, cookie).
 *
 * The branching is extracted into `decideRootEntry()` so every acceptance
 * criterion of issue #223 can be pinned by vitest in node env, no DOM, no
 * router, no Convex client — same split discipline as `decideTenantGate`
 * (#175) and `decideSessionGate` (#164).
 *
 * Routing matrix (ADR 0014 §5 + issue #223):
 *
 *   - `wait`                         → session not ready yet (parent loader
 *                                      handles the spinner).
 *   - KB Admin (isAdmin=true)        → `/monitoring`.
 *     ADR 0014 §5 canonical target is `/pipeline`, but that page is a
 *     separate epic still in the backlog. `/monitoring` is the only live
 *     supervision route today and is the SUPERVISION_PINNED href in
 *     `tenant-switcher.tsx` (kept in sync — when `/pipeline` ships, change
 *     both lines). KB Admin with attached tenants STILL lands on
 *     supervision (the resto views are reachable through the switcher,
 *     never via auto-redirect — ADR 0014 §1).
 *   - KB Manager mono-tenant         → `/t/<theirOnlyTenantId>/menu`.
 *     `/menu` is the default sub-route (matches the sidebar fallback in
 *     `decideSidebarNav` AND the `/t/[id]` root page itself which also
 *     redirects to `/menu`).
 *   - KB Manager multi-tenant        → `/t/<chosenTenantId>/menu`, where
 *     `chosenTenantId` is the `kb_current_tenant` cookie hint when it
 *     points at a tenant still owned (last opened resto, ADR 0014 §4 — the
 *     cookie is a hint, not the source of truth), else the FIRST tenant of
 *     the list. A stale / absent cookie falls through to the first-tenant
 *     fallback without crashing — defensive default for an empty hint
 *     channel.
 *
 * No `tenants.length === 0 && !isAdmin` branch — `SessionGuard` already
 * renders `NoTenantEmptyState` for that case and the page never reaches
 * this decision; we treat it defensively as `wait` (do nothing) rather
 * than crash if the assumption ever breaks.
 */
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

export type RootEntryInput = {
  session: SessionState;
  /** The current `kb_current_tenant` cookie value (hint only, ADR 0014 §4). */
  cookieTenantId: Id<"tenants"> | undefined;
};

export type RootEntryDecision =
  | { kind: "wait" }
  | { kind: "redirect"; href: string };

/** The supervision landing for KB Admin. Kept in lockstep with
 *  `SUPERVISION_PINNED.href` in `tenant-switcher.tsx` — when `/pipeline`
 *  ships, change both lines and the contract holds. */
const KB_ADMIN_LANDING = "/monitoring";

/**
 * Build the operational landing URL for a given tenantId.
 *
 * Centralised so the manager redirect, the mono-tenant redirect, and any
 * future "go back to my resto" CTA all agree on the same default sub-route.
 * Matches the sidebar fallback in `decideSidebarNav` AND the `/t/[id]` root
 * page (`apps/admin/src/app/(app)/t/[tenantId]/page.tsx`) so the chrome
 * (active sidebar item) and the URL always agree.
 */
export function buildTenantLanding(tenantId: Id<"tenants">): string {
  return `/t/${tenantId as unknown as string}/menu`;
}

/**
 * Pure mapping from `(session, cookieTenantId)` to the action the React
 * shell executes on `/`.
 *
 * Treats `loading` / `unauthenticated` / missing-tenant as `wait` — the
 * parent layout (`SessionLoader` + `SessionGuard`) is the authority on
 * those states and renders the appropriate spinner / empty state.
 */
export function decideRootEntry(input: RootEntryInput): RootEntryDecision {
  const { session, cookieTenantId } = input;

  // Session not resolved → defer to the loader / guard upstream.
  if (session.status !== "ready") {
    return { kind: "wait" };
  }

  const { isAdmin, tenants } = session.session;

  // KB Admin — supervision space, REGARDLESS of attached tenants (those
  // are reachable through the switcher, never via auto-redirect per
  // ADR 0014 §1).
  if (isAdmin) {
    return { kind: "redirect", href: KB_ADMIN_LANDING };
  }

  // KB Manager — pick the chosen tenant.
  if (tenants.length === 0) {
    // Defensive: `SessionGuard` would already have rendered
    // `NoTenantEmptyState` upstream. Hold instead of crashing if the
    // upstream guard is ever bypassed.
    return { kind: "wait" };
  }

  // Mono-tenant — no ambiguity, ignore the cookie entirely (the manager has
  // exactly one resto).
  if (tenants.length === 1) {
    return { kind: "redirect", href: buildTenantLanding(tenants[0].tenantId) };
  }

  // Multi-tenant — the cookie is a HINT (last opened resto). Honour it only
  // when it still points at a tenant the manager owns; otherwise fall back
  // to the first tenant of the list (same fallback as
  // `decideSidebarNav` / `decideTenantGate.redirectTo`).
  const cookieValid =
    cookieTenantId !== undefined &&
    tenants.some((t) => t.tenantId === cookieTenantId);
  const target = cookieValid ? cookieTenantId : tenants[0].tenantId;
  return { kind: "redirect", href: buildTenantLanding(target) };
}
