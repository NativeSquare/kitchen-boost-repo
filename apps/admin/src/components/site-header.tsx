"use client";

/**
 * Site header — the top chrome strip rendered above every (app) page.
 *
 * Two responsibilities:
 *   1. The sidebar collapse trigger (`<SidebarTrigger/>`).
 *   2. The always-visible `<TenantSwitcher/>` mandated by ADR 0014 §7 — its
 *      shape (display-only / dropdown / cherchable + Supervision) adapts to
 *      the role via `decideTenantSwitcher`.
 *
 * The original scaffold also rendered a manual breadcrumb that pattern-matched
 * on `/team` and `/users` paths — paths that ADR 0014 §1 + §56 explicitly
 * removed from the shell (the legacy root-only Users/Team scaffold). With the
 * paths gone, the breadcrumb was both dead code AND a source of broken `<Link
 * href="/team">General</Link>` references that pointed at a deleted route. It
 * was deleted with the rest of the scaffold cleanup.
 *
 * A real, route-aware breadcrumb (e.g. « Pipeline / Fiche prospect / Khan »
 * under `/pipeline/[prospectId]`) belongs to its own slice, scoped per-route,
 * not as a generic header guess. Until then the header stays minimal — the
 * sidebar carries the active-route signal.
 */
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TenantSwitcher } from "@/components/app/tenant-switcher";

export function SiteHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <div className="ml-auto">
          <TenantSwitcher />
        </div>
      </div>
    </header>
  );
}
