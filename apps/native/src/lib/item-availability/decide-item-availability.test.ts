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
    // Convex `useQuery` sentinel for a query still in flight.
    expect(decideTooltipGate({ device: undefined })).toEqual({
      kind: "loading",
    });
  });

  it("show tooltip when the user has NEVER seen it (fresh device, no row yet)", () => {
    // No row in `devices` yet — the user just signed in on a brand-new device.
    // PRD 20 §7c REQUIRES the tooltip text on first usage, so we must NOT
    // pre-emptively fire the mutation.
    expect(decideTooltipGate({ device: null })).toEqual({
      kind: "show-tooltip",
    });
  });

  it("show tooltip when the row exists but `itemToggleTooltipSeen` is absent (legacy row pre-#408 migration)", () => {
    // Older devices may carry rows from #393 without the new tooltip flag.
    // The field is optional; absence means « never seen » — same UX as a
    // fresh device.
    expect(
      decideTooltipGate({
        device: {
          itemToggleTooltipSeen: undefined,
        },
      }),
    ).toEqual({ kind: "show-tooltip" });
  });

  it("show tooltip when `itemToggleTooltipSeen === false` (explicit reset)", () => {
    // Defensive: an explicit `false` should behave like undefined. The native
    // mutation only ever STAMPS `true`, but a hypothetical admin reset for
    // user-support reasons must still re-prompt.
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: false },
      }),
    ).toEqual({ kind: "show-tooltip" });
  });

  it("proceed directly when the user has already seen the tooltip (subsequent usages, PRD 20 §7c « dismissé pour usages suivants »)", () => {
    expect(
      decideTooltipGate({
        device: { itemToggleTooltipSeen: true },
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
 * #408 — exact spec'd copy verification.
 *
 * The PRD pins the EXACT first-usage tooltip wording (PRD 20 §7c). The
 * component reads this constant; pinning it as a test prevents a rename or
 * a casual rewording from drifting from the PRD.
 */
describe("#408 ITEM_TOGGLE_TOOLTIP_TEXT — exact spec'd copy (PRD 20 §7c)", () => {
  it("matches the PRD-frozen sentence verbatim — single source of truth", async () => {
    const { ITEM_TOGGLE_TOOLTIP_TEXT } =
      await import("./decide-item-availability");
    expect(ITEM_TOGGLE_TOOLTIP_TEXT).toBe(
      "Ce toggle masque l'item du menu côté client. Pas de modification permanente — il restera disponible dans ton catalogue KB Admin.",
    );
  });
});
