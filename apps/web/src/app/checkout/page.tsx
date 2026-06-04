/**
 * PWA-S6 (#454) — `/checkout` RSC page (US 44, decisions-log Q2 « /checkout
 * → RSC + boundaries client », Q3 « identity preload », Q8 « détection
 * canal actif côté front pour gate Payer »).
 *
 * Hybrid render:
 *  - RSC reads the `__Host-kb_tenant` cookie (set by the PWA edge middleware,
 *    PWA-S1 #449) → resolves the tenant's name for the heading + the CGV
 *    wording (« CGV de {Resto} »).
 *  - RSC reads the Convex Auth token via `convexAuthNextjsToken()` and
 *    `preloadQuery(getCurrentCustomer)` to (a) pre-fill the form
 *    (firstName/email/phone — acceptance criterion #454) and (b) seed the
 *    push enrollment subscription used by the client `<CheckoutForm>` for
 *    the realtime "Payer" gate (decisions-log Q8). The preloaded payload
 *    is hydrated into a reactive `usePreloadedQuery` in the client
 *    component — subsequent flips on `customers.pushEnrollment` re-evaluate
 *    the gate without any reload.
 *  - The `<CheckoutForm>` is the client component that owns the form IO
 *    + the Convex sub + the gated "Payer X €" button.
 *
 * The empty-cart redirect to `/panier` is client-only (the cart lives in
 * localStorage — invisible from the RSC). The form renders `null` while
 * the redirect is in flight (decided by `decideCheckoutRedirect`).
 *
 * Defensive degraded state: cookie missing (= matcher mis-config in the
 * middleware) → render the generic KB shell with a back-to-/ link. NEVER
 * crash on `undefined!`.
 *
 * S6a/S6b/S6c (#455 / #456 / #457) will add the push enrollment MODAL the
 * "Payer" CTA opens when the gate is disabled — S6 stops at the
 * « Coming next » placeholder. S7 (#458) wires Stripe.
 */
import { cookies } from "next/headers";
import Link from "next/link";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { CartProvider } from "@/components/cart/cart-context";
import { DeliveryModeProvider } from "@/components/delivery-mode/delivery-mode-context";
import { CheckoutForm } from "@/components/checkout/checkout-form";

const TENANT_COOKIE = "__Host-kb_tenant";

export default async function CheckoutPage() {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  if (tenantId === undefined) {
    // Degraded state — see file header. No form, just a back link.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold text-black">Paiement</h1>
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

  // Tenant name for the heading + the CGV wording (same minimal projection
  // PWA-S1 uses).
  const tenant = await fetchQuery(api.lib.tenants.resolution.byId, {
    tenantId,
  });

  // Pre-load the customer fiche server-side so the client form hydrates with
  // the prefill defaults + the current `pushEnrollment` snapshot. The token
  // is read from the Convex Auth session cookie (host-only, intra-resto —
  // ADR 0008); if absent (first visit / private mode / 1-year expiry) the
  // sub returns `null` and the form starts empty + gate disabled (no
  // enrollment → modal-coming-next placeholder).
  const token = await convexAuthNextjsToken();
  if (token === undefined) {
    // Unauthenticated customer landing on /checkout (e.g. direct URL paste
    // without going through /). Same degraded shape as missing cookie —
    // they need to start from / to provision their fiche.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold text-black">Paiement</h1>
          <p className="text-base text-zinc-600">
            Commence par valider ton adresse pour passer commande.
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

  const preloadedCustomer = await preloadQuery(
    api.lib.customer.identity.getCurrentCustomer,
    { tenantId },
    { token },
  );

  const restoName = tenant === null ? "KitchenBoost" : tenant.name;

  return (
    <main className="min-h-screen bg-zinc-50">
      <CartProvider>
        <DeliveryModeProvider>
          <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-32 pt-8 md:px-8">
            <header className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold text-black">Paiement</h1>
              <p className="text-sm text-zinc-600">
                Commande chez{" "}
                <strong className="text-zinc-700">{restoName}</strong>.
              </p>
            </header>

            <CheckoutForm
              tenantId={tenantId}
              restoName={restoName}
              preloadedCustomer={preloadedCustomer}
            />

            <footer>
              <Link
                href="/panier"
                className="text-sm font-medium text-zinc-700 hover:underline"
              >
                ← Modifier mon panier
              </Link>
            </footer>
          </div>
        </DeliveryModeProvider>
      </CartProvider>
    </main>
  );
}
