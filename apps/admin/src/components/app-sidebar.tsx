"use client";

/**
 * F-SHELL-06 — role-conditional sidebar (ADR 0014 §1 + issue #196).
 *
 * The sidebar is a thin React shell over `decideSidebarNav()` — the pure
 * decision function (tested in `app-sidebar.decision.test.ts`) maps
 * `(session, pathname)` to ONE of three shapes:
 *
 *   - `hidden`              → render the chrome but no nav items (defensive;
 *                              SessionGuard / NoTenantEmptyState own the
 *                              "no resto rattaché" case).
 *   - `admin-supervision`   → KB Admin outside `/t/[id]/...`: Pipeline, CRM,
 *                              Monitoring, Tenants — absolute supervision
 *                              URLs.
 *   - `manager-operational` → KB Manager (anywhere) OR KB Admin under
 *                              `/t/[id]/...`: Menu, Commandes, Mes clients,
 *                              Campagnes, Pricing, QR, Paramètres — every
 *                              href scoped to the resolved currentTenantId
 *                              (URL > first own tenant fallback).
 *
 * The legacy "Users" / "Team" items of the old root-only scaffold are
 * REMOVED entirely (PRD 70 + ADR 0014 — they don't belong to either jeu).
 *
 * Pattern hérité de `brain-analytics-platform/apps/web/src/components/app-sidebar.tsx`:
 * items derived from a session-shaped role, filtered + scoped, then mapped to
 * shadcn `<SidebarMenuItem/>` rows with `next/link` `<Link/>` for type-safe
 * client-side navigation.
 *
 * Security note: the real isolation barrier is BACKEND (ADR 0010) — if a
 * route leaks into the wrong bundle the Convex wrappers `tenantQuery` /
 * `kbAdminQuery` will refuse regardless. This sidebar gating is UX only.
 */

import * as React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  IconChartBar,
  IconGauge,
  IconInnerShadowTop,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconSpeakerphone,
  IconQrcode,
  IconSettings,
  IconShoppingCart,
  IconTag,
  IconToolsKitchen2,
  IconUsersGroup,
  IconBuildingStore,
} from "@tabler/icons-react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/session";
import type { SessionState } from "@/lib/session";

// ---------------------------------------------------------------------------
// 1. Pure decision: `decideSidebarNav`
// ---------------------------------------------------------------------------

/** One nav row: shadcn `<SidebarMenuItem/>` + `<Link href>`. The icon comes
 * from `@tabler/icons-react` (compatible with the rest of the shell). */
export type SidebarNavItem = {
  label: string;
  href: string;
  iconName: SidebarIconName;
};

/** Discriminator over icon set so the pure function stays serialisable (no
 * React component refs leaking into vitest). The React layer resolves the
 * name → component via `ICONS` below. */
export type SidebarIconName =
  | "pipeline"
  | "crm"
  | "monitoring"
  | "tenants"
  | "dashboard"
  | "menu"
  | "commandes"
  | "mes-clients"
  | "stats"
  | "campagnes"
  | "pricing"
  | "qr"
  | "parametres";

export type SidebarNavInput = {
  session: SessionState;
  /** `usePathname()` result. `null` (not under a route) treated like `/`. */
  pathname: string | null;
};

export type SidebarNavDecision =
  | { kind: "hidden"; items: [] }
  | { kind: "admin-supervision"; items: SidebarNavItem[] }
  | { kind: "manager-operational"; items: SidebarNavItem[] };

/** Extract `<tenantId>` from a `/t/[tenantId]/...` pathname. Returns `null`
 * when the pathname is not under `/t/`. Strict `/t/` match (not `/team`).
 *
 * `Id<"tenants">` is branded but lives in the URL as a plain string — we
 * preserve the brand at the type boundary the same way the rest of the shell
 * does (cf. tenant-context.tsx). */
function parseTenantIdFromPath(pathname: string | null): Id<"tenants"> | null {
  if (!pathname) return null;
  // Match exactly `/t/<segment>` or `/t/<segment>/...`. Reject `/team`,
  // `/tenants`, `/teams/...` — the `/` after the id (or end of string) is the
  // discriminator.
  const match = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return match[1] as unknown as Id<"tenants">;
}

const ADMIN_SUPERVISION_ITEMS: SidebarNavItem[] = [
  { label: "Pipeline", href: "/pipeline", iconName: "pipeline" },
  { label: "CRM", href: "/crm", iconName: "crm" },
  { label: "Monitoring", href: "/monitoring", iconName: "monitoring" },
  { label: "Tenants", href: "/tenants", iconName: "tenants" },
];

function buildOperationalItems(tenantId: Id<"tenants">): SidebarNavItem[] {
  const base = `/t/${tenantId as unknown as string}`;
  return [
    { label: "Tableau de bord", href: base, iconName: "dashboard" },
    { label: "Menu", href: `${base}/menu`, iconName: "menu" },
    { label: "Commandes", href: `${base}/commandes`, iconName: "commandes" },
    {
      label: "Mes clients",
      href: `${base}/mes-clients`,
      iconName: "mes-clients",
    },
    { label: "Statistiques", href: `${base}/stats`, iconName: "stats" },
    { label: "Campagnes", href: `${base}/campagnes`, iconName: "campagnes" },
    { label: "Pricing", href: `${base}/pricing`, iconName: "pricing" },
    { label: "QR", href: `${base}/qr`, iconName: "qr" },
    { label: "Paramètres", href: `${base}/parametres`, iconName: "parametres" },
  ];
}

/**
 * Pure decision — see file-header docblock + acceptance criteria in
 * `app-sidebar.decision.test.ts` for the full behaviour matrix.
 */
export function decideSidebarNav(input: SidebarNavInput): SidebarNavDecision {
  const { session, pathname } = input;

  // Defensive guards. SessionGuard already short-circuits these upstream;
  // returning `hidden` here keeps the sidebar from rendering nav items it
  // would never be allowed to actually navigate to.
  if (session.status !== "ready") {
    return { kind: "hidden", items: [] };
  }
  const { isAdmin, tenants } = session.session;
  if (!isAdmin && tenants.length === 0) {
    return { kind: "hidden", items: [] };
  }

  // Operational space = URL is under `/t/[id]/...` (any actor) OR KB Manager
  // outside `/t/[id]` (we still want their operational sidebar, scoped to
  // their first tenant as a fallback).
  const urlTenantId = parseTenantIdFromPath(pathname);
  if (urlTenantId !== null) {
    return {
      kind: "manager-operational",
      items: buildOperationalItems(urlTenantId),
    };
  }

  if (!isAdmin) {
    // KB Manager outside `/t/[id]` → fallback default tenant (first of list).
    // `tenants.length > 0` is guaranteed by the guard above.
    const fallback = tenants[0].tenantId;
    return {
      kind: "manager-operational",
      items: buildOperationalItems(fallback),
    };
  }

  // KB Admin outside `/t/[id]` → supervision space.
  return { kind: "admin-supervision", items: ADMIN_SUPERVISION_ITEMS };
}

// ---------------------------------------------------------------------------
// 2. React layer
// ---------------------------------------------------------------------------

const ICONS: Record<
  SidebarIconName,
  React.ComponentType<{ className?: string }>
> = {
  pipeline: IconLayoutKanban,
  crm: IconUsersGroup,
  monitoring: IconGauge,
  tenants: IconBuildingStore,
  dashboard: IconLayoutDashboard,
  menu: IconToolsKitchen2,
  commandes: IconShoppingCart,
  "mes-clients": IconUsersGroup,
  stats: IconChartBar,
  campagnes: IconSpeakerphone,
  pricing: IconTag,
  qr: IconQrcode,
  parametres: IconSettings,
};

function isRouteActive(
  pathname: string,
  href: string,
  iconName: SidebarIconName,
): boolean {
  // "Tableau de bord" points at the base `/t/<id>` — without strict-equal it
  // would prefix-match every operational sub-route and stay permanently active.
  if (iconName === "dashboard") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(href + "/");
}

const NavRow = ({
  item,
  pathname,
}: {
  item: SidebarNavItem;
  pathname: string;
}) => {
  const Icon = ICONS[item.iconName] ?? IconChartBar;
  const active = isRouteActive(pathname, item.href, item.iconName);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.href}>
          <Icon className="size-4" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const session = useSession();

  const decision = decideSidebarNav({ session, pathname });

  // NavUser footer identity is sourced from `session.user` (D1 — the same
  // bootstrap query that drives the routing), which is available to BOTH
  // KB Admin AND KB Manager — unlike the old `api.table.admin.currentAdmin`
  // (root-only, returned `null` for a manager → blank footer). Skeleton
  // until the session resolves, then a stable {name,email,avatar} triple
  // with defensive fallbacks for the optional fields.
  const user =
    session.status === "ready"
      ? {
          name: session.session.user.name || "Admin",
          email: session.session.user.email || "",
          avatar: session.session.user.image || "",
        }
      : null;

  // The header CTA points home for the supervision space and to the first
  // operational route for managers — either way, the nav under it is the
  // single source of truth.
  const headerHref =
    decision.kind === "manager-operational" && decision.items.length > 0
      ? decision.items[0].href
      : "/";

  const groupLabel =
    decision.kind === "admin-supervision"
      ? "Supervision"
      : decision.kind === "manager-operational"
        ? "Resto"
        : null;

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="KitchenBoost">
              <Link href={headerHref}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-sm bg-primary">
                  <IconInnerShadowTop className="size-5 text-primary-foreground" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium">KitchenBoost</span>
                  <span className="text-xs text-muted-foreground">
                    {decision.kind === "admin-supervision"
                      ? "Supervision"
                      : decision.kind === "manager-operational"
                        ? "Vue opérationnelle"
                        : "Admin Panel"}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {decision.items.length > 0 && groupLabel !== null && (
          <SidebarGroup>
            <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {decision.items.map((item) => (
                  <NavRow
                    key={item.href}
                    item={item}
                    pathname={pathname ?? ""}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        {user ? (
          <NavUser user={user} />
        ) : (
          <div className="flex items-center gap-2 p-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
