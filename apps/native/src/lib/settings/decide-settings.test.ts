import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  decideRebasculeMode,
  decideSettingsVisibility,
  decideStripeBadge,
  decideUberBadge,
} from "./decide-settings";

/**
 * #418 — `decideSettingsVisibility` + `decideRebasculeMode` + badges, pinned
 * as pure functions (PRD 20 §10 « Settings complète »). Same split convention
 * as `decideForceUpdate` (#394), `decideTenantSwitcher` (#399),
 * `decideClosureControl` (#407), `decidePrinterConfigForm` (#412) — React,
 * Expo, Convex stay OUT so the visibility matrix lives in a fast node
 * vitest suite (no jsdom, no native mocks).
 *
 * The Settings screen is the aggregator of every previously-built section
 * (profile, notifs, tenant info, printer, switcher, kiosque toggle, logout,
 * version, support). This module decides ONLY which sections are visible
 * given the current device mode + session — and the rebascule confirmation
 * flow that drives the « Passer en mode kiosque » row.
 */

// Tenant IDs that look enough like the real branded Id<"tenants"> for the
// decision matrix. Cast via the same pattern as `decide-tenant-switcher.test.ts`.
const TENANT_A = "tenant_a" as unknown as Id<"tenants">;
const TENANT_B = "tenant_b" as unknown as Id<"tenants">;

describe("#418 decideSettingsVisibility — section gating (PRD 20 §10)", () => {
  describe("loading guard", () => {
    it("session === null AND mode === null → tenant-scoped sections hidden, universal sections visible", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: null,
        session: null,
      });
      // Universal-ish — but tenant scope + admin scope unresolved → off.
      expect(verdict.showProfile).toBe(true);
      expect(verdict.showNotifs).toBe(true);
      expect(verdict.showLogout).toBe(true);
      expect(verdict.showVersion).toBe(true);
      expect(verdict.showSupport).toBe(true);
      // Defensive: tenant-scoped sections gated until session resolves.
      expect(verdict.showAccountTenant).toBe(false);
      expect(verdict.showPrinter).toBe(false);
      expect(verdict.showSwitcher).toBe(false);
      expect(verdict.showKiosqueToggle).toBe(false);
    });

    it("session resolved but mode still null → kiosque toggle + switcher hidden", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: null,
        session: { isAdmin: false, tenantCount: 1 },
      });
      expect(verdict.showAccountTenant).toBe(true);
      expect(verdict.showPrinter).toBe(true);
      // Mode-dependent rows wait for `device.mode` to flush.
      expect(verdict.showKiosqueToggle).toBe(false);
      expect(verdict.showSwitcher).toBe(false);
    });
  });

  describe("téléphone mode (non-admin)", () => {
    it("mono-tenant phone user → no switcher row, kiosque toggle visible, tenant sections visible", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: "telephone",
        session: { isAdmin: false, tenantCount: 1 },
      });
      expect(verdict.showAccountTenant).toBe(true);
      expect(verdict.showPrinter).toBe(true);
      expect(verdict.showSwitcher).toBe(false); // mono-tenant — nothing to switch.
      expect(verdict.showKiosqueToggle).toBe(true);
    });

    it("multi-tenant phone user (Walid case) → switcher row VISIBLE, kiosque toggle visible", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: "telephone",
        session: { isAdmin: false, tenantCount: 3 },
      });
      expect(verdict.showSwitcher).toBe(true);
      expect(verdict.showKiosqueToggle).toBe(true);
      expect(verdict.showAccountTenant).toBe(true);
      expect(verdict.showPrinter).toBe(true);
    });
  });

  describe("kiosque mode (PRD 20 §1b « switcher caché »)", () => {
    it("multi-tenant kiosque → switcher HIDDEN, kiosque toggle visible (allows rebascule)", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: "kiosque",
        session: { isAdmin: false, tenantCount: 3 },
      });
      // Per PRD 20 §1b — switcher caché en mode kiosque (tenant pinné).
      expect(verdict.showSwitcher).toBe(false);
      // Toggle stays available so the gérant can rebasculer (PRD 20 §12).
      expect(verdict.showKiosqueToggle).toBe(true);
      expect(verdict.showAccountTenant).toBe(true);
      expect(verdict.showPrinter).toBe(true);
    });

    it("mono-tenant kiosque → switcher hidden, kiosque toggle visible", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: "kiosque",
        session: { isAdmin: false, tenantCount: 1 },
      });
      expect(verdict.showSwitcher).toBe(false);
      expect(verdict.showKiosqueToggle).toBe(true);
    });
  });

  describe("kb_admin (root override — PRD 20 §1c)", () => {
    it("admin user → tenant-scoped sections HIDDEN, kiosque toggle HIDDEN", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: "telephone",
        session: { isAdmin: true, tenantCount: 0 },
      });
      // Per PRD 20 §1c — l'admin règle ses pins via KB Admin web.
      expect(verdict.showAccountTenant).toBe(false);
      expect(verdict.showPrinter).toBe(false);
      expect(verdict.showSwitcher).toBe(false);
      expect(verdict.showKiosqueToggle).toBe(false);
      // Profile, notifs, logout, version, support stay visible.
      expect(verdict.showProfile).toBe(true);
      expect(verdict.showLogout).toBe(true);
    });
  });

  describe("non-admin without attachment (edge — PRD 20 §1b « pas encore rattaché »)", () => {
    it("tenantCount === 0 + téléphone → no tenant sections, kiosque toggle visible (rebascule disabled at action layer)", () => {
      const verdict = decideSettingsVisibility({
        deviceMode: "telephone",
        session: { isAdmin: false, tenantCount: 0 },
      });
      expect(verdict.showAccountTenant).toBe(false);
      expect(verdict.showPrinter).toBe(false);
      expect(verdict.showSwitcher).toBe(false);
      // Toggle row stays visible — the rebascule decision blocks at the
      // action layer with the « no tenant » verdict.
      expect(verdict.showKiosqueToggle).toBe(true);
    });
  });
});

describe("#418 decideRebasculeMode — mode switch confirmation (PRD 20 §10 point 6)", () => {
  it("kiosque → téléphone : simple confirm (backend clears pin atomically)", () => {
    expect(
      decideRebasculeMode({
        currentMode: "kiosque",
        attachedTenantIds: [TENANT_A],
      }),
    ).toEqual({ kind: "confirm-telephone" });

    // Multi-tenant equally simple — no pin to choose for téléphone.
    expect(
      decideRebasculeMode({
        currentMode: "kiosque",
        attachedTenantIds: [TENANT_A, TENANT_B],
      }),
    ).toEqual({ kind: "confirm-telephone" });
  });

  it("téléphone → kiosque, mono-tenant : confirm with implicit pin", () => {
    const verdict = decideRebasculeMode({
      currentMode: "telephone",
      attachedTenantIds: [TENANT_A],
    });
    expect(verdict).toEqual({
      kind: "confirm-kiosque-mono",
      pinnedTenantId: TENANT_A,
    });
  });

  it("téléphone → kiosque, multi-tenant : surface tenant picker (mirror #393)", () => {
    const verdict = decideRebasculeMode({
      currentMode: "telephone",
      attachedTenantIds: [TENANT_A, TENANT_B],
    });
    expect(verdict).toEqual({
      kind: "confirm-kiosque-pick",
      choices: [TENANT_A, TENANT_B],
    });
  });

  it("téléphone → kiosque, no tenant : block with friendly message (mirror #393)", () => {
    const verdict = decideRebasculeMode({
      currentMode: "telephone",
      attachedTenantIds: [],
    });
    expect(verdict).toEqual({ kind: "unavailable-kiosque-no-tenant" });
  });
});

describe("#418 decideStripeBadge — integration health badge (mirror #411 critical gate)", () => {
  it("ready → ok (green)", () => {
    expect(decideStripeBadge({ stripeStatus: "ready" })).toBe("ok");
  });

  it("pending → warning (KYC en cours, mirror banner #411 non-critique)", () => {
    expect(decideStripeBadge({ stripeStatus: "pending" })).toBe("warning");
  });

  it("disabled → error (mirror gate #411 critique « Stripe restricted »)", () => {
    expect(decideStripeBadge({ stripeStatus: "disabled" })).toBe("error");
  });

  it("null → idle (pre-onboarding, no Stripe account linked)", () => {
    expect(decideStripeBadge({ stripeStatus: null })).toBe("idle");
  });
});

describe("#418 decideUberBadge — integration health badge (mirror #411 livraison seul mode)", () => {
  it("configured → ok regardless of acceptedModes", () => {
    expect(
      decideUberBadge({
        uberDirectConfigured: true,
        acceptedModes: { delivery: true, clickAndCollect: false },
      }),
    ).toBe("ok");
    expect(
      decideUberBadge({
        uberDirectConfigured: true,
        acceptedModes: { delivery: false, clickAndCollect: true },
      }),
    ).toBe("ok");
  });

  it("not configured + acceptedModes null → idle (pre-config)", () => {
    expect(
      decideUberBadge({
        uberDirectConfigured: false,
        acceptedModes: null,
      }),
    ).toBe("idle");
  });

  it("not configured + delivery seul mode actif → error (mirror gate critique #411)", () => {
    expect(
      decideUberBadge({
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: false },
      }),
    ).toBe("error");
  });

  it("not configured + delivery + clickAndCollect → error (delivery est actif)", () => {
    expect(
      decideUberBadge({
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: true },
      }),
    ).toBe("error");
  });

  it("not configured + clickAndCollect seul → idle (livraison désactivée, Uber non requis)", () => {
    expect(
      decideUberBadge({
        uberDirectConfigured: false,
        acceptedModes: { delivery: false, clickAndCollect: true },
      }),
    ).toBe("idle");
  });
});
