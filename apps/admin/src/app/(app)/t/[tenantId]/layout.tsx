"use client";

/**
 * F-SHELL-04 — chrome-less layout for `/t/[tenantId]/...`.
 *
 * "Chrome-less" means we add ZERO visual chrome of our own: the sidebar +
 * header come from the parent `(app)/layout.tsx` (the unique shell, ADR 0014
 * §1). This layout's job is plumbing only:
 *
 *   1. Read `tenantId` from the URL segment (`useParams`).
 *   2. Validate it against the session (KB Manager must own it; KB Admin can
 *      reach any existing tenant; otherwise → explicit UnauthorizedCard or
 *      404 — A4 of the manual E2E checklist; no silent redirect).
 *   3. Provide the validated `tenantId` to children via `<TenantProvider/>`
 *      so `useCurrentTenantId()` (and, downstream, F-SHELL-05's
 *      `useTenantQuery` / `useTenantMutation`) can inject it everywhere.
 *   4. Write the `kb_current_tenant` cookie on every successful entry — a
 *      HINT for the next session's redirect, never the source of truth
 *      (ADR 0014 §4).
 *
 * Every branching decision is delegated to the pure `decideTenantGate` (see
 * `../../../components/app/tenant-context.tsx`) — the React layer is a thin
 * shell that executes the decision.
 *
 * On KB Admin existence probe: we use `api.lib.stripe.account.loadTenantForStripe`
 * as the "does this tenant exist" probe. It's a root-only (`kbAdminQuery`)
 * read of one tenant row returning `Doc<"tenants"> | null` — exactly the
 * shape we need. The Stripe-flavoured name is incidental and stays an
 * implementation detail of this layout; if a generic `getTenantByIdAdmin`
 * lands later, swap it here without touching `decideTenantGate`. (F-SHELL-04
 * scope is `apps/admin/src/` only — adding a new backend query is out of
 * scope of this issue per epic #139.)
 */

import { notFound, useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/lib/session";
import {
  TenantProvider,
  decideTenantGate,
  formatTenantCookie,
  parseTenantCookie,
} from "@/components/app/tenant-context";
import type { AdminTenantLookup } from "@/components/app/tenant-context";
import { UnauthorizedCard } from "@/components/app/unauthorized-card";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import { IconBuildingStore } from "@tabler/icons-react";

export default function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ tenantId: string }>();
  const urlTenantId = params?.tenantId as unknown as Id<"tenants">;

  const session = useSession();

  // Cookie is read on every render (cheap, lives on document). The decision
  // function consumes it as a hint when the manager lands on a tenant they
  // don't own — see decideTenantGate.
  const cookieTenantId = useMemo(() => {
    if (typeof document === "undefined") return undefined;
    return parseTenantCookie(document.cookie);
  }, []);

  // KB Admin existence probe. We only fire it when:
  //   - session is ready AND admin (no point probing for a manager: the
  //     decision short-circuits on `session.tenants` and never needs the
  //     lookup), AND
  //   - urlTenantId is non-empty (defensive — Next would not route here
  //     without a segment, but the type system can't prove it).
  // `"skip"` keeps the Convex hook stable while keeping the type inference
  // intact (per convex-test guidelines).
  const isAdminReady = session.status === "ready" && session.session.isAdmin;
  const tenantDoc = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    isAdminReady && urlTenantId ? { tenantId: urlTenantId } : "skip",
  );
  const adminTenantLookup: AdminTenantLookup = isAdminReady
    ? tenantDoc === undefined
      ? undefined
      : { exists: tenantDoc !== null }
    : undefined;

  const decision = decideTenantGate({
    session,
    urlTenantId,
    cookieTenantId,
    adminTenantLookup,
  });

  // Cookie write on allow lives in useEffect so the render stays pure. We
  // NO LONGER auto-redirect on `not-authorized` — see UnauthorizedCard
  // branch below for the explicit-CTA UX (A4 of the manual E2E checklist).
  useEffect(() => {
    if (decision.kind === "allow" && typeof document !== "undefined") {
      document.cookie = formatTenantCookie(decision.tenantId);
    }
  }, [decision]);

  if (decision.kind === "not-found") {
    notFound();
  }

  if (decision.kind === "not-authorized") {
    // Explicit refusal — the previous implementation silently teleported
    // the user to their own tenant, which was indistinguishable from a
    // routing bug. Now we render an UnauthorizedCard with a single CTA
    // pointing at their fallback resto; the user CHOOSES to navigate.
    const href = `/t/${decision.redirectTo as unknown as string}`;
    return (
      <UnauthorizedCard
        description={
          <>
            Ce restaurant ne fait pas partie de votre périmètre. Si vous pensez
            qu&apos;il devrait, contactez l&apos;équipe KitchenBoost pour faire
            rattacher votre compte.
          </>
        }
        primaryAction={{
          label: "Aller à mon resto",
          href,
          icon: <IconBuildingStore />,
        }}
      />
    );
  }

  if (decision.kind === "wait") {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // decision.kind === "allow"
  // The `ImpersonationBanner` (F-SHELL-08, #214) is mounted INSIDE the
  // TenantProvider so it has access to `useCurrentTenantId()`. It surfaces
  // itself only when `session.isAdmin && currentTenantId` (i.e. exactly the
  // « KB Admin sur /t/[id] » case). For a KB Manager it renders nothing.
  return (
    <TenantProvider tenantId={decision.tenantId}>
      <ImpersonationBanner />
      {children}
    </TenantProvider>
  );
}
