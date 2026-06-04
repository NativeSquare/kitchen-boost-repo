/**
 * PWA-S3 (#451) — Address-first home (PRD §10 PWA Client, decisions-log Q3 + Q7).
 *
 * Hybrid render:
 *  - RSC reads the `__Host-kb_tenant` cookie (set by the PWA edge middleware,
 *    PWA-S1 #449) → resolves the tenant's name for the heading.
 *  - RSC reads the Convex Auth token via `convexAuthNextjsToken()` and
 *    `preloadQuery(getCurrentCustomer)` to SILENTLY pre-fill the address input
 *    for a returning Sophie (decisions-log Q3 « pré-remplissage 2ᵉ visite »).
 *    The « Bonjour {firstName} » banner is intentionally deferred to PWA-S12
 *    (#464) — at this stage the recognition is silent (Q3 decision).
 *  - The `<AddressFirstForm>` is the client component that owns the Places
 *    Autocomplete + the address-first chain (signIn → getOrCreate →
 *    updateAddress → requestDeliveryQuote → decide-action).
 *
 * Edge cases (already handled by the middleware, so they never reach here):
 *  - Unknown host / orphan cookie / inactive tenant → `/erreur?reason=...`.
 *  - Apex `kitchen-boost.fr` → `/erreur?reason=apex-host`.
 *
 * Defensive degraded state: cookie missing (= matcher mis-config in the
 * middleware) → render the generic KB shell without the form (the form
 * NEEDS a tenantId to run the chain). This keeps the page accessible even
 * if the routing is wrong, rather than throwing on `undefined!`.
 */
import { cookies } from "next/headers";
import { fetchQuery, preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { AddressFirstForm } from "@/components/address-first/address-first-form";

const TENANT_COOKIE = "__Host-kb_tenant";

export default async function Home() {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  if (tenantId === undefined) {
    // Degraded state — see file header. No form, no chain, just the shell.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-3xl font-bold text-black">KitchenBoost</h1>
          <p className="text-base text-zinc-600">Bienvenue sur KitchenBoost.</p>
        </div>
      </main>
    );
  }

  // Tenant name for the heading (the same minimal projection PWA-S1 uses).
  const tenant = await fetchQuery(api.lib.tenants.resolution.byId, {
    tenantId,
  });

  // Silent pre-fill for returning Sophie. The token is read from the Convex
  // Auth session cookie (host-only, intra-resto — ADR 0008); if the cookie is
  // absent (first visit / 1-year expiry / private mode) the query returns
  // `null` and the input renders empty.
  let initialAddress: string | undefined = undefined;
  const token = await convexAuthNextjsToken();
  if (token !== undefined) {
    // We use `preloadQuery` (not raw `fetchQuery`) so the Convex framework can
    // attach the preloaded payload to the RSC stream — same pattern referenced
    // in decisions-log Q3. The actual hydration into a client `useQuery` will
    // land in PWA-S12 when the banner needs the realtime sub; here we only
    // need the address string for `initialAddress`.
    const preloaded = await preloadQuery(
      api.lib.customer.identity.getCurrentCustomer,
      { tenantId },
      { token },
    );
    // `preloadedQueryResult` is the official server-safe extractor of the
    // pre-fetched value out of the `Preloaded<>` envelope (Convex docs).
    const fiche = preloadedQueryResult(preloaded);
    initialAddress = fiche?.address;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-bold text-black">
          {tenant === null ? "KitchenBoost" : tenant.name}
        </h1>
        <p className="text-base text-zinc-600">
          Indique-nous ton adresse, on vérifie si on peut te livrer.
        </p>
        <AddressFirstForm tenantId={tenantId} initialAddress={initialAddress} />
      </div>
    </main>
  );
}
