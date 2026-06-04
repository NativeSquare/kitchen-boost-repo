/**
 * PWA-S5 (#453) — `/panier`: cart page. RSC SHELL since PWA-S9a (#460) so
 * the `__Host-kb_tenant` cookie is readable for the palier 2
 * `<WalletPromptBanner>` (decisions-log Q5, US 28). The cart itself
 * (`<CartView>`, `<CartProvider>`) remains client-only — localStorage-backed
 * and self-sufficient.
 *
 * The page reads NO Convex query of its own at the RSC layer (one fast
 * cookie lookup + a trivial wrapper); the cart state lives in the
 * `<CartProvider>` (localStorage-backed, S4) and the delivery verdict
 * lives in the `<DeliveryModeProvider>` (one-shot localStorage read of
 * what S3 cached). Both are mounted in the client `<PanierBody>` so the
 * page is fully self-sufficient and free to navigate-into without server
 * round-trips (LCP-friendly + survives transient backend outages, which
 * only matter at checkout — S6).
 *
 * Layout :
 *  - Header : tenant heading + permanent `<DeliveryModeToggle>` (US 24).
 *  - Body : `<CartView>` (lines, Note, totals — US 20-23).
 *  - Footer (S5 scope) : back-to-menu link + a placeholder « Continuer
 *    vers le paiement » CTA that routes to `/checkout` (the checkout
 *    page itself is the S6 scope, not this slice).
 *  - Top banner (PWA-S9a) : `<WalletPromptBanner>` palier 2 — only when
 *    a tenantId is resolvable from the cookie (degraded state if not).
 */
import { cookies } from "next/headers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { PanierBody } from "@/components/cart/panier-body";

const TENANT_COOKIE = "__Host-kb_tenant";

export default async function PanierPage(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  // PWA-S10 (#462) — the `<AndroidInstallButton>` mounted inside `<PanierBody>`
  // labels itself « Installer {nom_resto} » (US 56). Fetch the tenant name at
  // the RSC layer (one extra query, cookie-resolved tenant — already paid for
  // by the rest of the PWA shells) rather than adding a Convex `useQuery`
  // inside the button (would couple the button to the tenant table). When the
  // cookie is missing (degraded), the lookup is skipped and the button still
  // renders nothing (no tenantId → no button mounted by `<PanierBody>`).
  const tenant =
    tenantId !== undefined
      ? await fetchQuery(api.lib.tenants.resolution.byId, { tenantId })
      : null;

  return (
    <main className="min-h-screen bg-zinc-50">
      <PanierBody tenantId={tenantId} tenantName={tenant?.name ?? "ce resto"} />
    </main>
  );
}
