/**
 * PWA-S1 (#449) — PWA Client home placeholder.
 *
 * The address-first form + recognition banner + push enrollment 3-paliers
 * land in subsequent slices (S2 / S3 / S4). This file is the absolute
 * minimum the home renders BEFORE those slices ship: it proves the tenant
 * resolution chain (host → middleware → cookie → tenantId) works end-to-end
 * by surfacing the resolved tenant name from the `__Host-kb_tenant` cookie.
 *
 * Reading the cookie via `next/headers` is RSC-native (no client JS, no
 * Convex round-trip on hot path — the middleware already wrote the cookie).
 * The tenant NAME is then fetched server-side via `fetchQuery` so the page
 * is server-rendered (LCP target <1.5s, PRD §10).
 *
 * Edge cases handled by the middleware (never reach this page):
 *  - Unknown host / orphan cookie / inactive tenant → `/erreur?reason=...`
 *  - Apex `kitchen-boost.fr` → `/erreur?reason=apex-host`
 */
import { cookies } from "next/headers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

const TENANT_COOKIE = "__Host-kb_tenant";

export default async function Home() {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  // If the cookie is missing here, the middleware DID NOT set it — which
  // means the middleware was bypassed (matcher mis-config) or the user hit
  // the apex. The /erreur rewrite should have caught the apex case, so
  // missing-cookie at the home is a defensive degraded state.
  const tenant =
    tenantId === undefined
      ? null
      : await fetchQuery(api.lib.tenants.resolution.byId, { tenantId });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-bold text-black">
          {tenant === null ? "KitchenBoost" : tenant.name}
        </h1>
        <p className="text-base text-zinc-600">
          {tenant === null
            ? "Bienvenue sur KitchenBoost."
            : `Bienvenue chez ${tenant.name}.`}
        </p>
        <p className="text-sm text-zinc-500">
          La commande arrive bientôt — l&apos;équipe prépare l&apos;app.
        </p>
      </div>
    </main>
  );
}
