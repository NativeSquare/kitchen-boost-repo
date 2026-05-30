"use client";

/**
 * F-MENU-01 (#187) — Route `/t/[tenantId]/menu/`.
 *
 * First tracer-bullet of EPIC F-MENU #149 (Édition menu, ADR 0015
 * « brouillon autosauvé + publication globale atomique »): mounts the page
 * skeleton, branches `api.lib.menu.categories.list` via `useTenantQuery`
 * (ADR 0014 §4 / F-SHELL-05 #183), and renders the read-only categories
 * list. CRUD lands in F-MENU-02 (#200), drag&drop in F-MENU-03 (#206),
 * publication wiring in F-MENU-10 (#254).
 *
 * Responsibilities (issue #187):
 *   1. Bind `categories.list` through `useTenantQuery` so the tenantId from
 *      `<TenantProvider/>` is injected automatically — never a raw
 *      `useQuery` (would bypass tenantId injection, ADR 0014 §4 / ADR 0010).
 *   2. Delegate rendering to the pure `MenuView` — keeps the page thin and
 *      the view testable under `environment: "node"` (same split as
 *      `mes-clients/page.tsx`).
 *   3. The header's « Aperçu » / « Publier » / « modifications non publiées »
 *      placeholders are rendered inside `MenuView` as disabled affordances —
 *      F-MENU-10 (#254) will activate them.
 *
 * Scope discipline (#187 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/`) is the ONLY surface touched
 * by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantQuery } from "@/hooks";

import { MenuView } from "./menu-view";

export default function MenuPage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by
  // the chrome-less `/t/[tenantId]` layout) and injects it into args (ADR
  // 0014 §4 / #183). `undefined` is the loading sentinel; an empty array
  // means the tenant has no categories yet; otherwise we render the list.
  const categories = useTenantQuery(api.lib.menu.categories.list);

  return <MenuView categories={categories} />;
}
