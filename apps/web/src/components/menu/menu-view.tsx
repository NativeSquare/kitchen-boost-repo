"use client";

/**
 * PWA-S4 (#452) — `<MenuView>` — the client surface of `/menu` (PRD §10
 * PWA Client US 14-19/62/66, decisions-log Q2).
 *
 * Owns the IO the RSC `app/menu/page.tsx` deliberately keeps out:
 *  - Convex subscription `getPublicMenu({tenantId})` for the LIVE overlay
 *    (`available` toggle KDS « Indisponible ce soir », US 17) — reuses the
 *    SAME query as the ISR fetch, but re-rendered client-side as the
 *    backend `menuItems.available` row changes. The `useQuery` snapshot
 *    REPLACES the initial RSC payload as soon as the realtime sub fires
 *    (~200ms — ADR 0015 pivot, the rupture 1-tap does NOT trigger a
 *    republication).
 *  - URL search params deep-link via `useSearchParams` →
 *    `decideMenuDeepLink` (pure, vitest-pinned):
 *      `?item=<id>`  ⇒ open the Vaul modal targeting that item (US 18, 62).
 *      `?promo=<id>` ⇒ scroll to that item + 2s highlight pulse (US 62).
 *      both present ⇒ `?item` wins (modal beats highlight).
 *  - Dietary filters (sans-gluten / végétarien / vegan, US 16) via
 *    `decideVisibleItems` (pure) — V1 front-side only, NO backend filter.
 *  - Anchor sidebar (US 14) generated from the resolved categories.
 *  - Item modal mount + URL sync (PRD §10 Q2 a — modal Vaul URL-stateful;
 *    `router.replace("/menu?item=...")` on open, `router.replace("/menu")`
 *    on close; back button closes modal without losing scroll position).
 *
 * Trade-off pinned by the architecture (decisions-log Q2 a):
 *  - The modal lives at `?item=<id>` (single page, not a separate route)
 *    so the back button preserves the menu's scroll position. The vaul
 *    Drawer renders as a bottom-sheet on mobile + side-drawer on desktop
 *    via the shared `<Drawer>` wrapper (`components/ui/drawer.tsx`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type {
  PublicMenu,
  PublicMenuItem,
} from "@packages/backend/convex/lib/menu/catalog";
import { decideVisibleItems, type DietaryFilter } from "@/lib/menu-filters";
import { decideMenuDeepLink } from "@/lib/menu-deep-link";
import { DeliveryModeToggle } from "@/components/delivery-mode/delivery-mode-toggle";
import { ItemModal } from "./item-modal";

export type MenuViewProps = {
  tenantId: Id<"tenants">;
  tenantName: string;
  /** RSC-fetched initial payload (served from ISR cache, LCP <1.5s on 4G). */
  initialMenu: PublicMenu;
  /** Page-level search params (item + promo deep-link). */
  searchParams: Record<string, string | string[] | undefined>;
};

const FILTER_LABELS: Record<DietaryFilter, string> = {
  "sans-gluten": "Sans gluten",
  vegetarien: "Végé",
  vegan: "Vegan",
};

const ALL_FILTERS: ReadonlyArray<DietaryFilter> = [
  "sans-gluten",
  "vegetarien",
  "vegan",
];

/** Format centimes → `9,50 €` (FR locale, no €.00 trailing for plain euros). */
function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export function MenuView({
  tenantId,
  tenantName,
  initialMenu,
  searchParams,
}: MenuViewProps): React.JSX.Element {
  // 1. Convex realtime sub — REPLACES the RSC payload as soon as the
  //    `available` overlay (or any draft change post-publish) flips.
  //    `initialData` is the ISR payload so the first paint is identical to
  //    the cached HTML; React Compiler memoises this for free.
  const live = useQuery(api.lib.menu.catalog.getPublicMenu, { tenantId });
  const menu: PublicMenu = live ?? initialMenu;

  // 2. Dietary filters — V1 front-side over the 14 UE 1169/2011 set.
  const [activeFilters, setActiveFilters] = useState<Set<DietaryFilter>>(
    new Set(),
  );
  const toggleFilter = useCallback((f: DietaryFilter) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(f)) {
        next.delete(f);
      } else {
        next.add(f);
      }
      return next;
    });
  }, []);

  // 3. Deep-link routing (pure decision, vitest-pinned).
  //    `useSearchParams` is the realtime source (it updates when
  //    `router.replace` runs the modal close); we keep the RSC `searchParams`
  //    as the SSR fallback to avoid a flash of "no modal" on first paint.
  const liveSearchParams = useSearchParams();
  const router = useRouter();
  const deepLink = useMemo(() => {
    const merged: Record<string, string | string[] | undefined> = {
      ...searchParams,
    };
    const liveItem = liveSearchParams.get("item");
    const livePromo = liveSearchParams.get("promo");
    if (liveItem !== null) merged.item = liveItem;
    if (livePromo !== null) merged.promo = livePromo;
    return decideMenuDeepLink(merged);
  }, [searchParams, liveSearchParams]);

  // 4. Open-modal helpers.
  const openItem = useCallback(
    (itemId: string) => {
      // URL-stateful: back button closes modal without losing scroll position.
      const url = new URL(window.location.href);
      url.searchParams.set("item", itemId);
      url.searchParams.delete("promo");
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    },
    [router],
  );
  const closeItem = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("item");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [router]);

  // 5. Scroll + 2s highlight pulse on `?promo=<id>` (US 62).
  //    The pulse target is DERIVED from `deepLink` (no extra state machine);
  //    we use the effect ONLY to (a) scroll the target into view as a side
  //    effect and (b) schedule the URL cleanup once the 2s pulse window has
  //    elapsed (which removes `?promo=` so a back/forward replay does not
  //    re-pulse on every nav — idempotent UX, US 62 spec).
  const pulseItemId =
    deepLink.kind === "scroll-and-highlight" ? deepLink.itemId : null;
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pulseItemId === null) return;
    const target = document.getElementById(`menu-item-${pulseItemId}`);
    if (target !== null) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (pulseTimerRef.current !== null) {
      clearTimeout(pulseTimerRef.current);
    }
    pulseTimerRef.current = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("promo");
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    }, 2000);
    return () => {
      if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
    };
  }, [pulseItemId, router]);

  // 6. Find the item targeted by `?item=` (for the modal). May be null if
  //    the id is bogus — modal closes silently in that case (no toast,
  //    PRD §10 « Edge cases »).
  const openedItem: PublicMenuItem | null = useMemo(() => {
    if (deepLink.kind !== "open-item-modal") return null;
    for (const category of menu.categories) {
      for (const item of category.items) {
        if (item._id === deepLink.itemId) return item;
      }
    }
    return null;
  }, [deepLink, menu]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pb-32 pt-8 md:px-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-black">{tenantName}</h1>
        <p className="text-sm text-zinc-600">
          Choisis tes plats — la livraison part dès que tu valides.
        </p>
        {/* Permanent delivery mode toggle (PWA-S5 #453, US 24). */}
        <DeliveryModeToggle />
        <Link
          href="/panier"
          className="self-start text-sm font-medium text-emerald-700 underline-offset-2 hover:underline"
        >
          Voir le panier →
        </Link>
      </header>

      {/* Filters (US 16) */}
      <FilterBar active={activeFilters} onToggle={toggleFilter} />

      <div className="flex gap-6 md:gap-10">
        {/* Anchor sidebar (US 14) — sticky on desktop, hidden on mobile. */}
        <nav
          aria-label="Catégories"
          className="sticky top-4 hidden h-[fit-content] w-44 shrink-0 self-start md:block"
        >
          <ul className="flex flex-col gap-2">
            {menu.categories.map((category) => (
              <li key={category._id}>
                <a
                  href={`#menu-cat-${category._id}`}
                  className="block rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  {category.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Items list */}
        <div className="flex-1">
          {menu.categories.length === 0 ? (
            <p className="text-base text-zinc-600">
              La carte est en cours de préparation, reviens dans un instant.
            </p>
          ) : (
            <div className="flex flex-col gap-10">
              {menu.categories.map((category, catIndex) => {
                const visibleItems = decideVisibleItems(
                  category.items,
                  activeFilters,
                );
                return (
                  <section
                    key={category._id}
                    id={`menu-cat-${category._id}`}
                    aria-labelledby={`menu-cat-h-${category._id}`}
                  >
                    <h2
                      id={`menu-cat-h-${category._id}`}
                      className="mb-3 text-xl font-semibold text-black"
                    >
                      {category.name}
                    </h2>
                    {visibleItems.length === 0 ? (
                      <p className="text-sm text-zinc-500">
                        Aucun plat ne correspond à tes filtres dans cette
                        catégorie.
                      </p>
                    ) : (
                      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {visibleItems.map((item, itemIndex) => (
                          <ItemCard
                            key={item._id}
                            item={item}
                            pulse={pulseItemId === item._id}
                            // Priority-load the hero category's first 4 items
                            // for LCP <1.5s (decisions-log Q2 b).
                            priority={catIndex === 0 && itemIndex < 4}
                            onOpen={() => openItem(item._id)}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Vaul modal — bottom-sheet mobile / side-drawer desktop (decisions Q2 a) */}
      <ItemModal
        item={openedItem}
        open={deepLink.kind === "open-item-modal" && openedItem !== null}
        onClose={closeItem}
        formatEur={formatEur}
      />
    </div>
  );
}

function FilterBar({
  active,
  onToggle,
}: {
  active: ReadonlySet<DietaryFilter>;
  onToggle: (f: DietaryFilter) => void;
}): React.JSX.Element {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Filtres alimentaires"
    >
      {ALL_FILTERS.map((f) => {
        const isActive = active.has(f);
        return (
          <button
            key={f}
            type="button"
            onClick={() => onToggle(f)}
            aria-pressed={isActive}
            className={
              isActive
                ? "rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white"
                : "rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            }
          >
            {FILTER_LABELS[f]}
          </button>
        );
      })}
    </div>
  );
}

function ItemCard({
  item,
  pulse,
  priority,
  onOpen,
}: {
  item: PublicMenuItem;
  pulse: boolean;
  priority: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const unavailable = !item.available;
  return (
    <li
      id={`menu-item-${item._id}`}
      className={
        pulse
          ? "rounded-lg border-2 border-emerald-500 shadow-md transition-all animate-pulse"
          : "rounded-lg border border-zinc-200"
      }
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={unavailable}
        className={
          unavailable
            ? "flex w-full cursor-not-allowed gap-3 p-3 text-left opacity-50"
            : "flex w-full gap-3 p-3 text-left hover:bg-zinc-50"
        }
        aria-label={`${item.name}${unavailable ? " — Indisponible ce soir" : ""}`}
      >
        {item.photoUrl !== null && (
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-zinc-100">
            <Image
              src={item.photoUrl}
              alt=""
              fill
              sizes="80px"
              priority={priority}
              loading={priority ? undefined : "lazy"}
              className="object-cover"
            />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-base font-medium text-black">{item.name}</span>
          {item.description.length > 0 && (
            <span className="line-clamp-2 text-sm text-zinc-600">
              {item.description}
            </span>
          )}
          <span className="text-sm font-medium text-black">
            {formatEur(item.basePrice)}
          </span>
          {unavailable && (
            <span className="text-xs font-medium uppercase text-red-700">
              Indisponible ce soir
            </span>
          )}
          {item.allergens.length > 0 && (
            <span className="text-xs text-zinc-500">
              Allergènes : {item.allergens.join(", ")}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
