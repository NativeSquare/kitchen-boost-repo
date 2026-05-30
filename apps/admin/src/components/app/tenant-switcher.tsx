"use client";

/**
 * F-SHELL-07 — `TenantSwitcher`, mounted in the shared `site-header.tsx`
 * (issue #208, ADR 0014 §7).
 *
 * The switcher is ALWAYS visible in the header (for any session-ready actor)
 * and its shape adapts to the role:
 *
 *   - KB Manager mono-tenant → display-only badge (NO actionable menu).
 *   - KB Manager multi-tenant → dropdown over `session.tenants` (no re-fetch).
 *   - KB Admin → searchable combobox over ALL tenants (lazy fetch via
 *     `useAllTenants()`), plus a pinned "Supervision" entry that navigates
 *     to `/pipeline`.
 *
 * As with every other shell tracer-bullet (#164, #175, #196), the branching
 * is extracted into pure `decideTenantSwitcher()` so vitest can pin every
 * acceptance criterion in the lean `node` env without jsdom / Convex.
 *
 * Selection writes the `kb_current_tenant` cookie eagerly (via
 * `formatTenantCookie` — single source for the cookie shape, ADR 0014 §4
 * + tenant-context.tsx) so the next navigation already has the hint and
 * the `/t/[id]/...` layout (issue #175) doesn't flash.
 *
 * Security note: this gating is UX only. The real isolation barrier remains
 * backend (`tenantQuery` / `kbAdminQuery`, ADR 0010) — even if a manager
 * crafts a URL to a tenant they don't own, the Convex wrappers throw.
 */

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  IconBuildingStore,
  IconCheck,
  IconChevronDown,
  IconLayoutKanban,
  IconSearch,
} from "@tabler/icons-react";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { api } from "@packages/backend/convex/_generated/api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import type { SessionState } from "@/lib/session";
import {
  KB_CURRENT_TENANT_COOKIE,
  formatTenantCookie,
} from "@/components/app/tenant-context";

// ---------------------------------------------------------------------------
// 1. Pure types + decision
// ---------------------------------------------------------------------------

/** One tenant option as understood by the switcher. The decision function
 * does not depend on Convex `Doc<"tenants">` — it only needs the id + the
 * human-readable name + the slug (for stable React keys / future search). */
export type TenantOption = {
  tenantId: Id<"tenants">;
  slug: string;
  name: string;
};

/** Lookup observation for the admin-only `useAllTenants()` query.
 *  `undefined` = in flight (or the backend query isn't merged yet — the
 *  stub also returns `undefined`); array = resolved (possibly empty). */
export type AllTenantsLookup = TenantOption[] | undefined;

/** The "current value" surfaced by the switcher. */
export type TenantSwitcherCurrent =
  | { kind: "supervision" }
  | { kind: "tenant"; tenantId: Id<"tenants">; name: string };

/** Pinned "Supervision" entry exposed to the KB Admin shape. */
export type SupervisionEntry = {
  kind: "supervision";
  label: "Supervision";
  href: "/pipeline";
};

export type TenantSwitcherInput = {
  session: SessionState;
  /** `usePathname()` result. `null` (no route) treated like `/`. */
  pathname: string | null;
  /** Result of `useAllTenants()` — undefined while in-flight / stub. */
  allTenants: AllTenantsLookup;
};

export type TenantSwitcherDecision =
  | { kind: "hidden" }
  | {
      kind: "display-only";
      current: { tenantId: Id<"tenants">; name: string };
    }
  | {
      kind: "manager-multi";
      current: TenantSwitcherCurrent;
      options: TenantOption[];
    }
  | {
      kind: "admin";
      current: TenantSwitcherCurrent;
      options: TenantOption[];
      optionsLoading: boolean;
      supervisionPinned: SupervisionEntry;
    };

/** Strict `/t/<id>` match (rejects `/team`, `/tenants`). Mirrors the
 *  app-sidebar helper — kept local to this module to stay self-contained,
 *  same regex shape so behaviour matches the sidebar. */
function parseTenantIdFromPath(pathname: string | null): Id<"tenants"> | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return match[1] as unknown as Id<"tenants">;
}

const SUPERVISION_PINNED: SupervisionEntry = {
  kind: "supervision",
  label: "Supervision",
  href: "/pipeline",
};

/**
 * Pure decision — see file-header docblock + the test matrix in
 * `tenant-switcher.decision.test.ts` for the full behaviour.
 */
export function decideTenantSwitcher(
  input: TenantSwitcherInput,
): TenantSwitcherDecision {
  const { session, pathname, allTenants } = input;

  // Defensive: session must be ready and the actor must have SOME access.
  if (session.status !== "ready") return { kind: "hidden" };
  const { isAdmin, tenants } = session.session;
  if (!isAdmin && tenants.length === 0) return { kind: "hidden" };

  const urlTenantId = parseTenantIdFromPath(pathname);

  // --- KB Manager mono-tenant ----------------------------------------------
  if (!isAdmin && tenants.length === 1) {
    const t = tenants[0];
    return {
      kind: "display-only",
      current: { tenantId: t.tenantId, name: t.name },
    };
  }

  // --- KB Manager multi-tenant ---------------------------------------------
  if (!isAdmin) {
    // Resolve current: URL wins if owned, else first own tenant (sidebar
    // fallback in decideSidebarNav).
    const fromUrl =
      urlTenantId !== null
        ? tenants.find((t) => t.tenantId === urlTenantId)
        : undefined;
    const current = fromUrl ?? tenants[0];
    return {
      kind: "manager-multi",
      current: {
        kind: "tenant",
        tenantId: current.tenantId,
        name: current.name,
      },
      options: tenants.map((t) => ({
        tenantId: t.tenantId,
        slug: t.slug,
        name: t.name,
      })),
    };
  }

  // --- KB Admin ------------------------------------------------------------
  // Current: URL tenant wins (root override — admin can be on any tenant);
  // otherwise Supervision. Name resolved from the lookup if available, else
  // a placeholder (the React layer can render a Skeleton if it wants to).
  const current: TenantSwitcherCurrent =
    urlTenantId !== null
      ? {
          kind: "tenant",
          tenantId: urlTenantId,
          name:
            allTenants?.find((t) => t.tenantId === urlTenantId)?.name ??
            (urlTenantId as unknown as string),
        }
      : { kind: "supervision" };

  return {
    kind: "admin",
    current,
    options: allTenants ?? [],
    optionsLoading: allTenants === undefined,
    supervisionPinned: SUPERVISION_PINNED,
  };
}

/**
 * Pure URL builder: given the current `pathname` and the chosen
 * `targetTenantId`, return the path to navigate to.
 *
 *   - `/t/<A>/menu`            + B → `/t/<B>/menu`           (preserve sub-path)
 *   - `/t/<A>/parametres/edit` + C → `/t/<C>/parametres/edit` (deep preserve)
 *   - `/t/<A>`                 + B → `/t/<B>`                 (no synthetic sub)
 *   - `/pipeline` / `/` / `/team` + A → `/t/<A>`              (drop into root op)
 */
export function buildSwitchTarget(
  pathname: string | null,
  targetTenantId: Id<"tenants">,
): string {
  const base = `/t/${targetTenantId as unknown as string}`;
  if (!pathname) return base;
  const match = pathname.match(/^\/t\/[^/]+(\/.*)?$/);
  if (!match) return base;
  const tail = match[1] ?? "";
  return `${base}${tail}`;
}

// ---------------------------------------------------------------------------
// 2. Stub `useAllTenants()` — to be replaced when listAllTenants ships
// ---------------------------------------------------------------------------

/**
 * Lazy query of every tenant in the DB. Consumed by the KB Admin combobox.
 *
 * Today, the backend query `api.table.tenants.listAllTenants` is NOT yet
 * merged (it's the dependency carried by ADR 0014 §7 — a new `kbAdminQuery`
 * returning `{ tenantId, slug, name }[]`, optionally accepting a search
 * string). To keep this story unblockable per the issue body ("Si la query
 * backend listAllTenants n'est pas encore mergée, mocker côté front avec
 * un stub typé"), we ship a STUB that:
 *
 *   - exposes the exact future signature (`(searchQuery?: string) => TenantOption[] | undefined`)
 *   - returns `undefined` (in-flight) so the React layer renders a skeleton
 *     / empty list with a hint, not a misleading "0 tenants" copy
 *
 * When the backend query lands, this hook switches to
 * `useQuery(api.table.tenants.listAllTenants, { search })` and nothing else
 * in the switcher changes — the consuming surface only sees `AllTenantsLookup`.
 */
type ListAllTenantsApi = {
  table?: { tenants?: { listAllTenants?: unknown } };
};

export function useAllTenants(searchQuery?: string): AllTenantsLookup {
  // Probe the api object at runtime — when the backend query lands it appears
  // here automatically (Convex generates `api.table.tenants.listAllTenants`),
  // and we use it; until then we no-op gracefully. This keeps the front
  // unblocked without faking data on screen.
  const apiAny = api as unknown as ListAllTenantsApi;
  const listAllTenantsRef = apiAny.table?.tenants?.listAllTenants;
  // `useQuery` is conditionally called via the "skip" pattern: when the
  // backend isn't there yet, we skip and return `undefined`.
  const result = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (listAllTenantsRef ?? undefined) as any,
    listAllTenantsRef ? { search: searchQuery ?? "" } : "skip",
  );
  if (!listAllTenantsRef) return undefined;
  return result as AllTenantsLookup;
}

// ---------------------------------------------------------------------------
// 3. React layer
// ---------------------------------------------------------------------------

/** Eagerly write the `kb_current_tenant` cookie so the next nav doesn't
 *  flash. The layout (#175) writes it too on entry — this is a hint to
 *  reduce time-to-first-correct-render. */
function persistTenantCookie(tenantId: Id<"tenants">): void {
  if (typeof document === "undefined") return;
  document.cookie = formatTenantCookie(tenantId);
}

/** Clear the cookie when navigating into supervision (no tenant courant). */
function clearTenantCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${KB_CURRENT_TENANT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function currentLabel(current: TenantSwitcherCurrent): string {
  return current.kind === "supervision" ? "Supervision" : current.name;
}

function CurrentIcon({ current }: { current: TenantSwitcherCurrent }) {
  return current.kind === "supervision" ? (
    <IconLayoutKanban className="size-4" />
  ) : (
    <IconBuildingStore className="size-4" />
  );
}

/** Display-only badge for the KB Manager mono-tenant case. Not a button. */
function DisplayOnly({
  current,
}: {
  current: { tenantId: Id<"tenants">; name: string };
}) {
  return (
    <div
      className="bg-muted text-foreground flex h-9 items-center gap-2 rounded-md px-3 text-sm"
      data-slot="tenant-switcher-display-only"
      aria-label={`Tenant courant : ${current.name}`}
    >
      <IconBuildingStore className="size-4" />
      <span className="truncate font-medium">{current.name}</span>
    </div>
  );
}

/** Shared trigger button used by both the multi-manager dropdown and the
 *  admin combobox — same visual contract, same accessible label shape. */
function TriggerButton({
  current,
  className,
}: {
  current: TenantSwitcherCurrent;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-9 min-w-40 justify-between gap-2", className)}
      data-slot="tenant-switcher-trigger"
      aria-label={`Tenant courant : ${currentLabel(current)}. Cliquer pour changer.`}
    >
      <span className="flex items-center gap-2 truncate">
        <CurrentIcon current={current} />
        <span className="truncate">{currentLabel(current)}</span>
      </span>
      <IconChevronDown className="text-muted-foreground size-4" />
    </Button>
  );
}

function ManagerMultiSwitcher({
  current,
  options,
}: {
  current: TenantSwitcherCurrent;
  options: TenantOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  function selectTenant(tenantId: Id<"tenants">) {
    persistTenantCookie(tenantId);
    router.push(buildSwitchTarget(pathname, tenantId));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TriggerButton current={current} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Mes restos
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => {
          const isCurrent =
            current.kind === "tenant" && current.tenantId === opt.tenantId;
          return (
            <DropdownMenuItem
              key={opt.tenantId as unknown as string}
              onSelect={() => selectTenant(opt.tenantId)}
              data-slot="tenant-switcher-option"
              data-tenant-id={opt.tenantId as unknown as string}
              className="gap-2"
            >
              <IconBuildingStore className="size-4" />
              <span className="flex-1 truncate">{opt.name}</span>
              {isCurrent && <IconCheck className="size-4" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AdminSwitcher({
  current,
  options,
  optionsLoading,
  supervisionPinned,
}: {
  current: TenantSwitcherCurrent;
  options: TenantOption[];
  optionsLoading: boolean;
  supervisionPinned: SupervisionEntry;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = React.useState("");

  function selectTenant(tenantId: Id<"tenants">) {
    persistTenantCookie(tenantId);
    router.push(buildSwitchTarget(pathname, tenantId));
  }

  function selectSupervision() {
    clearTenantCookie();
    router.push(supervisionPinned.href);
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [options, search]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TriggerButton current={current} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-72 p-0">
        <DropdownMenuItem
          onSelect={selectSupervision}
          data-slot="tenant-switcher-supervision"
          className="gap-2 rounded-none"
        >
          <IconLayoutKanban className="size-4" />
          <span className="flex-1 truncate">{supervisionPinned.label}</span>
          {current.kind === "supervision" && <IconCheck className="size-4" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-0" />
        <div className="relative p-2">
          <IconSearch className="text-muted-foreground absolute top-1/2 left-4 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Prevent the dropdown from intercepting typing (a/z/...).
              e.stopPropagation();
            }}
            placeholder="Rechercher un tenant..."
            className="h-8 pl-8"
            data-slot="tenant-switcher-search"
            aria-label="Rechercher un tenant"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {optionsLoading ? (
            <div className="space-y-1 p-1">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground p-3 text-center text-sm">
              Aucun tenant trouvé
            </div>
          ) : (
            filtered.map((opt) => {
              const isCurrent =
                current.kind === "tenant" && current.tenantId === opt.tenantId;
              return (
                <DropdownMenuItem
                  key={opt.tenantId as unknown as string}
                  onSelect={() => selectTenant(opt.tenantId)}
                  data-slot="tenant-switcher-option"
                  data-tenant-id={opt.tenantId as unknown as string}
                  className="gap-2"
                >
                  <IconBuildingStore className="size-4" />
                  <span className="flex-1 truncate">{opt.name}</span>
                  {isCurrent && <IconCheck className="size-4" />}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Public component, mounted in `site-header.tsx`. Always rendered; the
 * decision function decides whether to surface anything.
 */
export function TenantSwitcher() {
  const session = useSession();
  const pathname = usePathname();
  const allTenants = useAllTenants();

  const decision = decideTenantSwitcher({ session, pathname, allTenants });

  if (decision.kind === "hidden") return null;
  if (decision.kind === "display-only")
    return <DisplayOnly current={decision.current} />;
  if (decision.kind === "manager-multi")
    return (
      <ManagerMultiSwitcher
        current={decision.current}
        options={decision.options}
      />
    );
  return (
    <AdminSwitcher
      current={decision.current}
      options={decision.options}
      optionsLoading={decision.optionsLoading}
      supervisionPinned={decision.supervisionPinned}
    />
  );
}
