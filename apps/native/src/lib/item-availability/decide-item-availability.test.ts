/**
 * #408 — pure decision-function tests for the « Toggle dispo item » home control
 * (PRD 20 §7c + ADR 0018 frontière disponibilité commerciale / édition catalogue).
 *
 * Same split convention as `decideClosureControl` (#407), `decidePauseControl`
 * (#406), `decideTenantSwitcher` (#399), `decideForceUpdate` (#394): the truth
 * table lives in node-env vitest (no React, no Convex, no Expo), and the React
 * adapter `<ItemAvailabilityList />` is a thin host that resolves Convex
 * subscriptions and feeds them in.
 *
 * Two truth tables sit here:
 *
 *  1. `decideTooltipGate` — given the loaded `devices` row (or its loading /
 *     fresh sentinels) AND the current toggle intent, decide whether we must
 *     show the FIRST-USAGE tooltip BEFORE executing the toggle (PRD 20 §7c
 *     « Tooltip obligatoire au premier usage »), or fire the mutation
 *     immediately. Only the FIRST toggle on a device must surface the tooltip;
 *     subsequent toggles are silent (flag `device.itemToggleTooltipSeen`).
 *
 *  2. `decideItemListEntryPoint` — the home pill / nav entry verdict (`loading`
 *     / `hidden` / `ready`). Used by the home `<ItemAvailabilityEntry />` to
 *     avoid surfacing the entry before the tenant + device are resolved.
 */

import { describe, expect, it } from "vitest";
import {
  decideItemListEntryPoint,
  decideTooltipGate,
} from "./decide-item-availability";

describe("#408 decideTooltipGate — first-usage gate (PRD 20 §7c)", () => {
  it("loading when the devices row is still resolving — never fire a toggle while we cannot tell whether the user has already seen the tooltip", () => {
    // Convex `useQuery` sentinel for a query still in flight. The `targetAvailable`
    // axis is irrelevant while we cannot decide: we still block.
    expect(
      decideTooltipGate({ device: undefined, targetAvailable: false }),
    ).toEqual({
      kind: "loading",
    });
    expect(
      decideTooltipGate({ device: undefined, targetAvailable: true }),
    ).toEqual({
      kind: "loading",
    });
  });

  it("show tooltip when the user has NEVER seen it AND the toggle goes disponible → indisponible (sens dangereux)", () => {
    // No row in `devices` yet — the user just signed in on a brand-new device.
    // PRD 20 §7c REQUIRES the tooltip on first usage of the OFF direction (the
    // one that masks the item côté client). The native mutation must NOT fire
    // pre-emptively.
    expect(decideTooltipGate({ device: null, targetAvailable: false })).toEqual(
      {
        kind: "show-tooltip",
      },
    );
  });

  it("proceed directly when the user has NEVER seen the tooltip but the toggle goes indisponible → disponible (sens inverse — pas de pédagogie nécessaire)", () => {
    // Asymétrie OFF vs ON (post-test E2E 2026-06-07). Le tooltip explique « ça
    // masque côté client » — sens utile UNIQUEMENT pour OFF (disponible → indispo).
    // Le sens inverse (réactiver) ne nécessite pas cette pédagogie : flip direct.
    expect(decideTooltipGate({ device: null, targetAvailable: true })).toEqual({
      kind: "proceed",
    });
  });

  it("show tooltip when the row exists but `itemToggleTooltipSeen` is absent AND target is indisponible (legacy row pre-#408 migration)", () => {
    // Older devices may carry rows from #393 without the new tooltip flag.
    // The field is optional; absence means « never seen » — same UX as a
    // fresh device. Asymétrie OFF / ON s'applique aussi ici.
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: undefined },
        targetAvailable: false,
      }),
    ).toEqual({ kind: "show-tooltip" });
    // Sens inverse même sur un device legacy : flip direct.
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: undefined },
        targetAvailable: true,
      }),
    ).toEqual({ kind: "proceed" });
  });

  it("show tooltip when `itemToggleTooltipSeen === false` AND target is indisponible (explicit reset)", () => {
    // Defensive: an explicit `false` should behave like undefined. The native
    // mutation only ever STAMPS `true`, but a hypothetical admin reset for
    // user-support reasons must still re-prompt — sur le sens OFF uniquement.
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: false },
        targetAvailable: false,
      }),
    ).toEqual({ kind: "show-tooltip" });
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: false },
        targetAvailable: true,
      }),
    ).toEqual({ kind: "proceed" });
  });

  it("proceed directly when the user has already seen the tooltip (subsequent usages, both directions silent — PRD 20 §7c « dismissé pour usages suivants »)", () => {
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: true },
        targetAvailable: false,
      }),
    ).toEqual({ kind: "proceed" });
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: true },
        targetAvailable: true,
      }),
    ).toEqual({ kind: "proceed" });
  });
});

describe("#408 decideItemListEntryPoint — home entry-point verdict", () => {
  it("loading while the tenant or device is still resolving", () => {
    expect(
      decideItemListEntryPoint({
        activeTenantId: null,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("ready once the active tenant is resolved (kb_manager / staff in phone mode, or kiosque pinned tenant)", () => {
    expect(
      decideItemListEntryPoint({
        // The tenant id type is opaque here (string) — the decision only cares
        // « is there a tenant or not ». The native adapter receives the
        // branded `Id<"tenants">` from `useActiveTenantId` and forwards it.
        activeTenantId: "k57abcd1234567890123456789",
      }),
    ).toEqual({ kind: "ready", activeTenantId: "k57abcd1234567890123456789" });
  });
});

/**
 * #408 — exact spec'd copy verification (post-test E2E 2026-06-07 reword).
 *
 * Le PRD pin maintenant le verbatim simplifié post-test terrain : un titre
 * (question actionnable) + un sous-titre (effet côté client). Le composant
 * lit ces deux constants ; les pin ici prévient un drift PRD / code silencieux.
 */
describe("#408 ITEM_TOGGLE_TOOLTIP — exact spec'd copy (PRD 20 §7c, reworded 2026-06-07)", () => {
  it("title matches the PRD-frozen question verbatim — single source of truth", async () => {
    const { ITEM_TOGGLE_TOOLTIP_TITLE } =
      await import("./decide-item-availability");
    expect(ITEM_TOGGLE_TOOLTIP_TITLE).toBe(
      "Rendre cette article indisponible temporairement ?",
    );
  });

  it("body matches the PRD-frozen body verbatim — single source of truth", async () => {
    const { ITEM_TOGGLE_TOOLTIP_BODY } =
      await import("./decide-item-availability");
    expect(ITEM_TOGGLE_TOOLTIP_BODY).toBe(
      "En poursuivant, cet article ne sera plus disponible pour les clients jusqu'à réactivation.",
    );
  });
});
