/**
 * F-SHELL-10 (#233) — `decideProspectFiche` decision logic, pinned as a pure
 * function.
 *
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/page.tsx` is the supervision
 * fiche of a [[Prospect]] (cf. ADR 0014 §5 + amendement 2026-05-27: la clé est
 * `prospectId`, PAS `tenantId`, car le prospect précède le tenant). It is
 * accessible to `kb_admin` ONLY (the backend `api.prospects.get` will be
 * exposed via `kbAdminQuery` once it lands — see EPIC F-PIPELINE-CRM).
 *
 * The branching is extracted into `decideProspectFiche()` so every acceptance
 * criterion of issue #233 can be pinned by vitest in node env, no DOM, no
 * router, no Convex client — same split discipline as `decideSessionGate`
 * (#164), `decideTenantGate` (#175), and `decideRootEntry` (#223).
 *
 * Decision matrix (issue #233 acceptance criteria):
 *
 *   - `session.status !== "ready"`            → `wait` (parent SessionGuard
 *                                                owns the spinner).
 *   - `session.session.isAdmin === false`     → `forbidden` (the page must
 *                                                surface the explicit
 *                                                UnauthorizedCard — the real
 *                                                isolation barrier is backend
 *                                                `kbAdminQuery` per ADR 0010,
 *                                                this is the UX layer).
 *   - admin + prospect `undefined` (in-flight)→ `loading-prospect` (Convex
 *                                                query still resolving).
 *   - admin + prospect `null`  (no such doc)  → `not-found` (the page must
 *                                                surface a 404-ish empty
 *                                                state — clean, not raw).
 *   - admin + prospect hydrated               → `{ kind: "show", prospect }`.
 *
 * Why not let `useQuery` throw on a non-admin caller?
 * --------------------------------------------------
 * `kbAdminQuery` throws `FORBIDDEN: kb_admin role required` for any non-root
 * caller. If the page fired the query unconditionally, a manager landing on
 * `/pipeline/<id>` (via URL share, etc.) would surface a raw Convex error
 * boundary INSTEAD of the canonical UnauthorizedCard. Same pattern as
 * `/monitoring` (`previewIncidents` is skipped unless `isAdmin`): the
 * decision short-circuits to `forbidden` BEFORE the network round-trip even
 * fires, and the view renders the shared refusal card.
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

export type ProspectFicheInput = {
  session: SessionState;
  /**
   * The prospect from `useQuery(api.prospects.get, ...)`, which follows
   * Convex's tri-state contract:
   *   - `undefined` → query in flight (Convex hook before first reply).
   *   - `null`      → query resolved, no document with this id.
   *   - `Doc`       → query resolved, hydrated.
   *
   * When the query is skipped (e.g. non-admin caller, or stubbed prior to
   * F-PIPELINE-CRM landing `api.prospects.get`), pass `undefined` —
   * `decideProspectFiche` will short-circuit to `forbidden` on the session
   * check BEFORE looking at this field, so a stale `undefined` here doesn't
   * accidentally pin a manager into a loading spinner.
   */
  prospect: Doc<"prospects"> | null | undefined;
};

export type ProspectFicheDecision =
  | { kind: "wait" }
  | { kind: "forbidden" }
  | { kind: "loading-prospect" }
  | { kind: "not-found" }
  | { kind: "show"; prospect: Doc<"prospects"> };

/**
 * Pure mapping `(session, prospect) -> ProspectFicheDecision`. No React, no
 * router, no Convex — the React layer is a thin shell that executes the
 * decision.
 */
export function decideProspectFiche(
  input: ProspectFicheInput,
): ProspectFicheDecision {
  const { session, prospect } = input;

  // Session not resolved → defer to the loader / guard upstream.
  if (session.status !== "ready") {
    return { kind: "wait" };
  }

  // UX layer auth refusal. The real barrier is backend `kbAdminQuery`
  // (ADR 0010) — this branch only prevents the raw Convex error boundary
  // from leaking to a manager who deep-linked the URL.
  if (!session.session.isAdmin) {
    return { kind: "forbidden" };
  }

  if (prospect === undefined) {
    return { kind: "loading-prospect" };
  }
  if (prospect === null) {
    return { kind: "not-found" };
  }

  return { kind: "show", prospect };
}

/**
 * Build the operational landing URL for a provisioned prospect's tenant.
 *
 * Centralised so the « Ouvrir la vue resto » button on this page and any
 * future « return to tenant » CTA in the supervision space agree on the same
 * target. Lands on the bare `/t/<id>` segment (NOT `/t/<id>/menu` directly),
 * mirroring `tenant-switcher.tsx`'s `buildSwitchTarget` so the actor reaches
 * the same default sub-route regardless of where they came from — the
 * `/t/[id]` root page itself redirects to `/menu`.
 */
export function buildTenantOperationalHref(
  tenantId: Doc<"prospects">["tenantId"],
): string | null {
  if (tenantId === undefined || tenantId === null) return null;
  return `/t/${tenantId as unknown as string}`;
}
