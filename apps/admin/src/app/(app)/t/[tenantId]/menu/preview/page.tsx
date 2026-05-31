"use client";

/**
 * F-MENU-10 (#254) — Route `/t/[tenantId]/menu/preview/`.
 *
 * The « Aperçu » header button of the menu editor opens this page in a new
 * tab. It renders the LIVE DRAFT exactly as the PWA mangeur would render the
 * published snapshot — but sourced on `api.lib.menu.publication.previewMenu`
 * (B-MENU-PUBLICATION slice 4, #166, ADR 0015 « Aperçu admin lit le brouillon »),
 * NOT on `getPublicMenu` (which serves the published snapshot).
 *
 * Load-bearing observable (issue body):
 *   « j'édite un prix sans publier, Aperçu montre le NOUVEAU prix,
 *     getPublicMenu (PWA réelle) montre l'ANCIEN »
 *
 * Why an admin-side preview page (NOT the eater PWA with a `?preview=true`
 * query): `apps/web` does not yet ship the menu route — the issue body
 * explicitly leaves the detail free (« implementation V1 simple »). The hard
 * constraint is that the rendering is sourced on the DRAFT and that the
 * « Aperçu » → `getPublicMenu` divergence holds. Once the PWA menu route
 * lands, this page can either stay (admin-internal preview) or get a
 * companion `?preview=true` mode on the PWA; the editor's `previewHref`
 * forwards the decision in ONE place (`menu/page.tsx`).
 *
 * The page reads `previewMenu` via `useTenantQuery` (ADR 0014 §4 / #183 —
 * tenantId auto-injected) and renders a flat per-category list of items with
 * name + description + price (formatted via the shared `formatPriceCentimes`)
 * + an « épuisé » badge when `available === false`. Modifier groups are
 * NOT rendered (V1: preview surfaces the same wire as the PWA contract, but
 * the polished PWA rendering arrives with the F-PWA-MENU chain — not this
 * story). The wire contract `PublicMenu` shared with `getPublicMenu` means
 * the rendering stays trivially upgradable later (swap source, keep shape).
 *
 * Scope discipline (#254 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/preview/` — zero touch to
 * `apps/web`, `apps/native`, `packages/backend/convex/`.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { Badge } from "@/components/ui/badge";
import { useTenantQuery } from "@/hooks";

import { formatPriceCentimes } from "../format-price";

export default function MenuPreviewPage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by
  // the chrome-less `/t/[tenantId]` layout) and injects it into args. The
  // sentinel `undefined` is « still loading »; a tenant with no draft
  // returns `{ categories: [] }` (no throw — same edge as `getPublicMenu`
  // for a never-published tenant).
  const menu = useTenantQuery(api.lib.menu.publication.previewMenu);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 md:gap-6 md:py-8">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Aperçu (brouillon)
        </p>
        <h1 className="text-2xl font-bold">Menu</h1>
        <p className="text-muted-foreground text-sm">
          Vous voyez le brouillon, pas la version publique. Cliquez « Publier »
          dans l&apos;éditeur pour rendre ces changements visibles aux clients.
        </p>
      </header>
      {menu === undefined ? (
        <PreviewLoading />
      ) : menu.categories.length === 0 ? (
        <PreviewEmpty />
      ) : (
        <div className="flex flex-col gap-6" data-slot="menu-preview-body">
          {menu.categories.map((category) => (
            <section
              key={category._id}
              className="flex flex-col gap-2"
              data-slot="menu-preview-category"
            >
              <h2 className="text-lg font-semibold">{category.name}</h2>
              {category.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Aucun item dans cette catégorie.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {category.items.map((item) => (
                    <li
                      key={item._id}
                      className="flex items-start justify-between gap-3 rounded-md border p-3"
                      data-slot="menu-preview-item"
                    >
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          {item.available ? null : (
                            <Badge variant="secondary">épuisé</Badge>
                          )}
                        </div>
                        {item.description ? (
                          <span className="text-muted-foreground text-sm">
                            {item.description}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className="text-sm font-semibold tabular-nums"
                        data-slot="menu-preview-item-price"
                      >
                        {formatPriceCentimes(item.basePrice)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewLoading() {
  return (
    <p
      className="text-muted-foreground text-sm"
      data-slot="menu-preview-loading"
    >
      Chargement de l&apos;aperçu…
    </p>
  );
}

function PreviewEmpty() {
  return (
    <div
      className="rounded-md border border-dashed p-6 text-center"
      data-slot="menu-preview-empty"
    >
      <p className="text-muted-foreground text-sm">
        Aucune catégorie pour le moment. Créez au moins une catégorie et un item
        dans l&apos;éditeur, puis revenez ici.
      </p>
    </div>
  );
}
