"use client";

/**
 * F-MES-CLIENTS [2/4] (#186) — Route-segment Error Boundary for
 * `/t/[tenantId]/mes-clients/` (Next.js App Router convention).
 *
 * The page's `useTenantQuery(aggregateCustomerKPIs)` throws when the Convex
 * query fails — incl. the « Accès refusé » case where a `kb_manager`
 * attached to tenant A lands on `/t/B/mes-clients/` (`tenantQuery({ allow:
 * ["kb_manager"] })` rejects with Forbidden, ADR 0010). Without an Error
 * Boundary, that throw would unmount the entire `(app)` shell. This file
 * catches it at the route segment and renders a clean, MOAT-safe fallback —
 * no email/phone/name/address labels EVEN in the error path (the same anti-
 * PII contract pinned for `MesClientsView`).
 *
 * Mirrors `MesClientsView`'s `null` (error) branch copy verbatim so the
 * user sees the same surface whether the error went through the Boundary
 * (hard throw) or the view's prop (soft failure).
 *
 * Why both: `error.tsx` catches anything `useQuery` throws on its way up the
 * tree; the view's `null` branch is reserved for future paths where the
 * page can choose to render an inline error WITHOUT unmounting (e.g. if a
 * future caller wraps the query in a non-throwing helper). Today the
 * Boundary is the only source — but keeping the view tri-state lets us
 * change that without churning the test suite.
 */
import { useEffect } from "react";

type MesClientsErrorProps = {
  /** The error thrown by the query (logged for ops triage). */
  error: Error & { digest?: string };
  /** Next.js-provided callback to re-render the segment. */
  reset: () => void;
};

export default function MesClientsError({
  error,
  reset,
}: MesClientsErrorProps) {
  useEffect(() => {
    // Trace for ops — the message stays generic for the user (anti-leak).
    console.error("[mes-clients] query error", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Mes clients</h1>
      </div>
      <div className="px-4 lg:px-6">
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Impossible de charger vos KPI clients. Réessayez dans un instant.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-4 text-sm text-blue-600 underline hover:no-underline"
          >
            Réessayer
          </button>
        </div>
      </div>
    </div>
  );
}
