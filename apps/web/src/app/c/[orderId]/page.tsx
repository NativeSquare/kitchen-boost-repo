/**
 * PWA-S8 (#459) — `/c/[orderId]` : the customer-facing tracking page (PRD §10
 * PWA Client §11 « Page Tracking », US 50 → 55, decisions-log Q7).
 *
 * Hybrid render :
 *  - RSC reads the `__Host-kb_tenant` cookie (set by the PWA edge middleware,
 *    PWA-S1 #449) → resolves the tenant's name for the heading.
 *  - RSC hands `tenantId` + `orderId` to the `<TrackingView>` client component
 *    that subscribes via `useQuery(api.lib.orders.tracking.getOrderTracking)`.
 *    Convex pushes EVERY backend write (`recordStatus`, `confirmPayment`, the
 *    Uber webhook applier) → re-render < 500ms (acceptance criterion #459).
 *
 * Why NO `convexAuthNextjsToken()` here (cf. `/checkout`) : the tracking URL
 * is INTENTIONALLY UN-AUTH-GATED (US 55, decisions-log Q7). A customer must be
 * able to SHARE the URL (SMS / push deep-link) and have the recipient device
 * — even one with no Convex Auth cookie — render the page. The un-guessable
 * Convex `orderId` IS the access token, same model as a Stripe receipt URL.
 *
 * Edge cases :
 *  - Missing tenant cookie (= matcher mis-config in the middleware) → render
 *    the « degraded » shell with a back-to-/ link. NEVER crash on `undefined!`.
 *  - Missing / cross-tenant / deleted order → the client component handles the
 *    `null` from `getOrderTracking` with a « commande introuvable » empty state.
 */
import { cookies } from "next/headers";
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TrackingView } from "@/components/tracking/tracking-view";

const TENANT_COOKIE = "__Host-kb_tenant";

export default async function TrackingPage(props: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await props.params;
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  if (tenantId === undefined) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold text-black">Suivi de commande</h1>
          <p className="text-base text-zinc-600">
            Nous n&apos;arrivons pas à identifier ton resto. Recharge la page ou
            reviens à l&apos;accueil.
          </p>
          <Link
            href="/"
            className="text-sm font-medium text-emerald-700 hover:underline"
          >
            ← Retour à l&apos;accueil
          </Link>
        </div>
      </main>
    );
  }

  // Tenant name for the heading (the same minimal projection PWA-S1 uses).
  const tenant = await fetchQuery(api.lib.tenants.resolution.byId, {
    tenantId,
  });
  const restoName = tenant === null ? "KitchenBoost" : tenant.name;

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16 pt-8 md:px-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-black">Suivi de commande</h1>
          <p className="text-sm text-zinc-600">
            Commande chez <strong className="text-zinc-700">{restoName}</strong>
            .
          </p>
        </header>

        <TrackingView
          tenantId={tenantId}
          orderId={orderId as Id<"orders">}
          restoName={restoName}
        />

        <footer>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-700 hover:underline"
          >
            ← Retour à l&apos;accueil
          </Link>
        </footer>
      </div>
    </main>
  );
}
