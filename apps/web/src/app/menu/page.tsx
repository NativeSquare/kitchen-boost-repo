/**
 * PWA-S4 (#452) — `/menu` ISR + on-demand revalidate + overlay LIVE
 * (decisions-log Q2, PRD §10 PWA Client US 14-19/62/66).
 *
 * Render strategy (decisions-log Q2 b):
 *  - RSC reads `__Host-kb_tenant` cookie (set by edge middleware PWA-S1 #449).
 *  - The PUBLIC `getPublicMenu(tenantId)` query is fetched via
 *    `unstable_cache(...)` with the tag `menu:<tenantId>`. The cached HTML
 *    is served by Vercel CDN (LCP <1.5s on 4G); the Convex Manager click
 *    « Publier » triggers `internal.lib.menuRevalidate.revalidateMenuTag`
 *    which POSTs `/api/revalidate` with `{ tenantId }` → `revalidateTag(…)`
 *    invalidates this entry → next visit re-renders.
 *  - The LIVE `available` overlay (toggle KDS « Indisponible ce soir », US 17)
 *    is applied client-side via a Convex subscription in `<MenuView>` over
 *    the cached payload (NOT a full page reload — ADR 0015 pivot).
 *
 * The page is a thin shell: it fetches + passes the initial menu to the
 * client `<MenuView>` which owns the IO (modal Vaul URL-stateful, deep-link
 * params, filters, overlay LIVE).
 *
 * Degraded state: cookie missing (matcher misconfig) ⇒ minimal shell, no
 * fetch. Same fallback shape as PWA-S3 `app/page.tsx`.
 *
 * `revalidate: 60` baseline ensures the page can never serve stale data for
 * more than 60s even if the on-demand revalidate POST fails (NON-FATAL by
 * design in the Convex action). Combined with the on-demand tag, the
 * effective freshness target « <30s » in the AC is met in the nominal path.
 */
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { PublicMenu } from "@packages/backend/convex/lib/menu/catalog";
import { MenuView } from "@/components/menu/menu-view";
import { CartProvider } from "@/components/cart/cart-context";
import { DeliveryModeProvider } from "@/components/delivery-mode/delivery-mode-context";
import { AndroidInstallButton } from "@/components/a2hs-install";

const TENANT_COOKIE = "__Host-kb_tenant";

/** Baseline ISR revalidation in seconds — see file header. */
export const revalidate = 60;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Cached fetch keyed on `tenantId`. The `unstable_cache` tag is
 * `menu:<tenantId>` so the API route can invalidate exactly this entry on
 * publish (`revalidateTag("menu:<tenantId>")`).
 *
 * The cache key MUST encode the tenantId (it's the only variable input);
 * `unstable_cache` derives the key from the closure args, but to be
 * explicit and stable we ALSO pass it in the `keyParts` argument.
 */
async function fetchCachedMenu(tenantId: Id<"tenants">): Promise<PublicMenu> {
  const cached = unstable_cache(
    async (id: Id<"tenants">): Promise<PublicMenu> => {
      return fetchQuery(api.lib.menu.catalog.getPublicMenu, { tenantId: id });
    },
    ["menu", tenantId],
    {
      tags: [`menu:${tenantId}`],
      revalidate: 60,
    },
  );
  return cached(tenantId);
}

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const [cookieStore, params] = await Promise.all([cookies(), searchParams]);
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

  if (tenantId === undefined) {
    // Degraded state — no cookie, no fetch.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-3xl font-bold text-black">Menu</h1>
          <p className="text-base text-zinc-600">
            Indisponible pour le moment, reviens dans un instant.
          </p>
        </div>
      </main>
    );
  }

  // Tenant name for the heading + the initial ISR-cached menu payload.
  const [tenant, initialMenu] = await Promise.all([
    fetchQuery(api.lib.tenants.resolution.byId, { tenantId }),
    fetchCachedMenu(tenantId),
  ]);

  return (
    <main className="min-h-screen bg-white">
      <CartProvider>
        <DeliveryModeProvider tenantId={tenantId}>
          <MenuView
            tenantId={tenantId}
            tenantName={tenant?.name ?? "Menu"}
            initialMenu={initialMenu}
            searchParams={params}
          />
          {/* PWA-S10 (#462) — A2HS Android post-cart floating button. Lives
              INSIDE CartProvider (uses `useCart()` for the cart count gate)
              + relies on `<PWAInstallProvider>` in the root layout for the
              captured `beforeinstallprompt` event. Decision-driven (4-gate
              `decideA2hsButtonVisibility`) — renders nothing on iOS Safari,
              desktop, empty cart, already-installed standalone, or
              already-enrolled fiche. */}
          <AndroidInstallButton
            tenantId={tenantId}
            tenantName={tenant?.name ?? "ce resto"}
          />
        </DeliveryModeProvider>
      </CartProvider>
    </main>
  );
}
