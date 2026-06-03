import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  decideTenantSwitcher,
  resolveActiveTenantId,
} from "./decide-tenant-switcher";

/**
 * #399 — `decideTenantSwitcher` + `resolveActiveTenantId` pinned as pure
 * functions (PRD 20 §1b, §12 + AC7).
 *
 * The header switcher in `apps/native/src/lib/tenant-switcher/tenant-switcher.tsx`
 * is a thin adapter: it resolves the `(user, device)` Convex row via
 * `getMyDevice`, resolves the user's attached tenants via `getSession`, and
 * delegates the branching to these two pure functions. Same split as
 * `decideForceUpdate` (#394), `decidePushPermissionBanner` (#395) and
 * `decideOnboardingStep` (#398) — keep React / Convex / Expo out of the
 * decision so the matrix is pinned by a fast deterministic vitest suite
 * (Node env, no jsdom, no Convex harness, no native mocks).
 *
 * The story acceptance criteria pinned here, in one sentence each:
 *
 *  - AC7.a — Switcher visible in phone mode IF user has > 1 tenant.
 *  - AC7.b — Switcher hidden in kiosque mode (pinned, AC1 of #393).
 *  - AC7.c — Sélection persistée par device → `resolveActiveTenantId` reads
 *    `device.lastSelectedTenantId` first and falls back to `tenants[0]` when
 *    the persisted hint is no longer in the attachment list (race: a manager
 *    detached between two app launches).
 *  - AC7.d — Pas de leak cross-tenant: in kiosque mode the active tenant is
 *    ALWAYS `pinnedTenantId` (the backend enforces the pin guard on writes,
 *    cf. #393 devices fuzz — this front-side resolver just honours the pin).
 */

// Helper — branded fake ids the way the convex Id type expects (raw string).
const T_A = "tenantA_id" as unknown as Id<"tenants">;
const T_B = "tenantB_id" as unknown as Id<"tenants">;
const T_C = "tenantC_id" as unknown as Id<"tenants">;

const tenantA = { tenantId: T_A, name: "Thai Street Saint Michel" };
const tenantB = { tenantId: T_B, name: "Thai Street Châtelet" };
const tenantC = { tenantId: T_C, name: "Thai Street Bastille" };

// ---------------------------------------------------------------------------
// decideTenantSwitcher — header visibility
// ---------------------------------------------------------------------------

describe("#399 decideTenantSwitcher — kiosque mode hides the switcher (AC7.b)", () => {
  it("kiosque mode + N attached tenants → hidden (tenant pinned, PRD 20 §12)", () => {
    // Walid sur la tablette cuisine de Saint Michel : même attaché à 3 restos,
    // le sélecteur DOIT être masqué pour éviter qu'un cuisinier ne switche par
    // erreur en plein service.
    expect(
      decideTenantSwitcher({
        device: {
          mode: "kiosque",
          pinnedTenantId: T_A,
          lastSelectedTenantId: undefined,
        },
        tenants: [tenantA, tenantB, tenantC],
        isAdmin: false,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("kiosque mode + a single attached tenant → hidden (pinned)", () => {
    expect(
      decideTenantSwitcher({
        device: {
          mode: "kiosque",
          pinnedTenantId: T_A,
          lastSelectedTenantId: undefined,
        },
        tenants: [tenantA],
        isAdmin: false,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("#399 decideTenantSwitcher — phone mode visibility (AC7.a)", () => {
  it("phone mode + 3 attached tenants (Walid) → visible with the 3 options", () => {
    const decision = decideTenantSwitcher({
      device: {
        mode: "telephone",
        pinnedTenantId: undefined,
        lastSelectedTenantId: T_B,
      },
      tenants: [tenantA, tenantB, tenantC],
      isAdmin: false,
    });
    expect(decision.kind).toBe("visible");
    if (decision.kind !== "visible") return;
    expect(decision.tenants).toHaveLength(3);
    expect(decision.activeTenantId).toBe(T_B);
  });

  it("phone mode + 1 attached tenant → hidden (no choice to surface)", () => {
    // Le cas du restaurateur mono-resto : le switcher ne sert à rien, on évite
    // de polluer le header avec un chevron qui n'ouvre qu'une seule entrée.
    expect(
      decideTenantSwitcher({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: T_A,
        },
        tenants: [tenantA],
        isAdmin: false,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("phone mode + 0 attached tenants → hidden (degraded state, no switcher to render)", () => {
    // Edge case: user authentifié mais aucun rattachement actif (KB Ops
    // détache tous ses tenants entre deux sessions). On ne crashe pas, on
    // n'affiche rien — la home gérera l'empty state.
    expect(
      decideTenantSwitcher({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: undefined,
        },
        tenants: [],
        isAdmin: false,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("#399 decideTenantSwitcher — kb_admin root override", () => {
  it("kb_admin + phone mode → hidden (no userTenants exposed via getSession, PRD 20 §1b note)", () => {
    // ADR 0011 + getSession contract : un kb_admin n'a pas de userTenants. Le
    // switcher applicatif n'a pas de sens — l'admin règle ses pins via KB
    // Admin web (cf. (device-setup) ligne 76-83). On reste cohérent : pas de
    // switcher exposé côté app native.
    expect(
      decideTenantSwitcher({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: undefined,
        },
        tenants: [],
        isAdmin: true,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("#399 decideTenantSwitcher — guards", () => {
  it("device row still loading (mode=undefined) → hidden (no flash of empty switcher)", () => {
    // Bootstrap : _layout.tsx maintient déjà un spinner tant que device est
    // undefined, mais le switcher est mounted INSIDE le shell donc on défend
    // en profondeur — un flash de switcher vide est un bug UX.
    expect(
      decideTenantSwitcher({
        device: undefined,
        tenants: [tenantA, tenantB],
        isAdmin: false,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("session still loading (tenants=undefined) → hidden", () => {
    expect(
      decideTenantSwitcher({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: undefined,
        },
        tenants: undefined,
        isAdmin: false,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

// ---------------------------------------------------------------------------
// resolveActiveTenantId — which tenant is the app "scoped to" right now
// ---------------------------------------------------------------------------

describe("#399 resolveActiveTenantId — kiosque pin wins (AC7.d, no leak)", () => {
  it("kiosque mode + valid pinnedTenantId → returns the pin", () => {
    expect(
      resolveActiveTenantId({
        device: {
          mode: "kiosque",
          pinnedTenantId: T_A,
          lastSelectedTenantId: T_B,
        },
        tenants: [tenantA, tenantB, tenantC],
        isAdmin: false,
      }),
    ).toBe(T_A);
  });

  it("kiosque mode + pinnedTenantId NOT in attached list (race: detach after pin) → null", () => {
    // Walid pin Saint Michel en kiosque, puis KB Ops révoque son rattachement
    // à ce tenant pendant qu'il dort. Au prochain launch, le pin pointe sur
    // un tenant invisible. On NE LEAKE PAS le pin — on renvoie null et le
    // shell affichera un empty state (le re-toggle vers téléphone se fera via
    // Settings TB-21).
    expect(
      resolveActiveTenantId({
        device: {
          mode: "kiosque",
          pinnedTenantId: T_C,
          lastSelectedTenantId: undefined,
        },
        tenants: [tenantA, tenantB],
        isAdmin: false,
      }),
    ).toBeNull();
  });
});

describe("#399 resolveActiveTenantId — phone mode lastSelected hint (AC7.c)", () => {
  it("phone mode + lastSelectedTenantId valid → returns it", () => {
    expect(
      resolveActiveTenantId({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: T_B,
        },
        tenants: [tenantA, tenantB, tenantC],
        isAdmin: false,
      }),
    ).toBe(T_B);
  });

  it("phone mode + lastSelectedTenantId stale (race: detached) → first tenant fallback", () => {
    // Walid avait Châtelet par défaut, KB Ops détache Châtelet, au relance
    // on tombe sur Saint Michel (premier de la liste) plutôt que crasher.
    expect(
      resolveActiveTenantId({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: T_B,
        },
        tenants: [tenantA, tenantC],
        isAdmin: false,
      }),
    ).toBe(T_A);
  });

  it("phone mode + NO lastSelectedTenantId (first launch in phone mode) → first tenant", () => {
    expect(
      resolveActiveTenantId({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: undefined,
        },
        tenants: [tenantA, tenantB],
        isAdmin: false,
      }),
    ).toBe(T_A);
  });

  it("phone mode + 0 attached tenants → null (empty state)", () => {
    expect(
      resolveActiveTenantId({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: undefined,
        },
        tenants: [],
        isAdmin: false,
      }),
    ).toBeNull();
  });
});

describe("#399 resolveActiveTenantId — guards", () => {
  it("device row still loading → null (caller awaits)", () => {
    expect(
      resolveActiveTenantId({
        device: undefined,
        tenants: [tenantA],
        isAdmin: false,
      }),
    ).toBeNull();
  });

  it("session still loading → null", () => {
    expect(
      resolveActiveTenantId({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: undefined,
        },
        tenants: undefined,
        isAdmin: false,
      }),
    ).toBeNull();
  });

  it("kb_admin + phone mode → null (no userTenants, see decideTenantSwitcher note)", () => {
    expect(
      resolveActiveTenantId({
        device: {
          mode: "telephone",
          pinnedTenantId: undefined,
          lastSelectedTenantId: undefined,
        },
        tenants: [],
        isAdmin: true,
      }),
    ).toBeNull();
  });
});
