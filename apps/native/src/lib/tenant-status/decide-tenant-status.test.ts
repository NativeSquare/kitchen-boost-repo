import { describe, expect, it } from "vitest";
import { decideTenantStatus } from "./decide-tenant-status";

/**
 * #411 — `decideTenantStatus` pure decision (PRD 20 §13 « Alertes statut
 * tenant » + `docs/contexts/kb-orders/CONTEXT.md` « Alerte statut critique »).
 *
 * Same split convention as `decideForceUpdate` (#394), `decideSessionRevoked`
 * (#400), `decideConnectionLost` (#405) — pinning the matrix here so the
 * adapter component stays a thin React shell.
 *
 * Three issue-acceptance scenarios pinned (the « 1-3 tests E2E » expressed as
 * scenario-level decisions):
 *
 *  (a) Stripe `disabled` (= PRD's « restricted ») → écran rouge bloquant. The
 *      banner / warning path NEVER fires in parallel — CRITICAL wins.
 *
 *  (b) Stripe revient en `"ready"` → l'écran disparaît, on bascule sur les
 *      warnings éventuels (Uber dégradé, tenant incomplet) ou sur `none`.
 *
 *  (c) Stripe `pending` (KYC pending_verification) sans autre incident →
 *      banner orange, app fonctionnelle. Pas d'écran rouge.
 *
 * Plus the orthogonal Uber Direct truth-table cases and the loading-state
 * guard (all inputs not yet resolved by the Convex sub).
 */

const baseHealthy = {
  stripeStatus: "ready" as const,
  uberDirectConfigured: true,
  acceptedModes: { delivery: true, clickAndCollect: true },
  tenantStatus: "active" as const,
};

describe("#411 decideTenantStatus — scenario (a) Stripe restricted → écran rouge", () => {
  it("Stripe `disabled` → CRITICAL stripe even if every other field is healthy", () => {
    expect(
      decideTenantStatus({ ...baseHealthy, stripeStatus: "disabled" }),
    ).toEqual({ kind: "critical", reason: "stripe" });
  });

  it("Stripe `disabled` wins over a parallel Uber-direct-only critical condition", () => {
    // Stripe KO is paiement refusé totalement = priorité absolue (sans paiement,
    // l'Uber n'a même pas matière à être chargé).
    expect(
      decideTenantStatus({
        stripeStatus: "disabled",
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: false },
        tenantStatus: "active",
      }),
    ).toEqual({ kind: "critical", reason: "stripe" });
  });

  it("Stripe `disabled` wins over a tenant-incomplete warning", () => {
    expect(
      decideTenantStatus({
        ...baseHealthy,
        stripeStatus: "disabled",
        tenantStatus: "pending",
      }),
    ).toEqual({ kind: "critical", reason: "stripe" });
  });
});

describe("#411 decideTenantStatus — scenario (b) Stripe revient en `ready` → écran disparaît", () => {
  it("Stripe `ready` + everything else healthy → none", () => {
    expect(decideTenantStatus(baseHealthy)).toEqual({ kind: "none" });
  });

  it("Stripe flips disabled → ready : verdict bascule de critical à none instantanément", () => {
    const before = decideTenantStatus({
      ...baseHealthy,
      stripeStatus: "disabled",
    });
    const after = decideTenantStatus({ ...baseHealthy, stripeStatus: "ready" });
    expect(before).toEqual({ kind: "critical", reason: "stripe" });
    expect(after).toEqual({ kind: "none" });
  });
});

describe("#411 decideTenantStatus — scenario (c) Stripe pending_verification → banner KYC", () => {
  it("Stripe `pending` + tout le reste healthy → WARNING stripe-kyc-pending", () => {
    expect(
      decideTenantStatus({ ...baseHealthy, stripeStatus: "pending" }),
    ).toEqual({ kind: "warning", reason: "stripe-kyc-pending" });
  });

  it("Stripe `pending` n'éclipse PAS un Uber-direct-only critique (Uber-only seul mode = CRITICAL gagne)", () => {
    // L'Uber-only critique est tellement bloquant qu'il doit gagner sur le
    // banner Stripe KYC. Note: decideTenantStatus traite Stripe `disabled`
    // EN PREMIER (cf. truth table) — `pending` n'est PAS aussi grave que
    // `disabled`, donc l'Uber-only critique passe AVANT le banner KYC.
    expect(
      decideTenantStatus({
        stripeStatus: "pending",
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: false },
        tenantStatus: "active",
      }),
    ).toEqual({ kind: "critical", reason: "uber-direct-only" });
  });
});

describe("#411 decideTenantStatus — Uber Direct truth table", () => {
  it("Uber down + livraison SEULE active → CRITICAL uber-direct-only", () => {
    expect(
      decideTenantStatus({
        stripeStatus: "ready",
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: false },
        tenantStatus: "active",
      }),
    ).toEqual({ kind: "critical", reason: "uber-direct-only" });
  });

  it("Uber down + click & collect ALSO active → WARNING uber-direct-degraded (mode dégradé)", () => {
    expect(
      decideTenantStatus({
        stripeStatus: "ready",
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: true },
        tenantStatus: "active",
      }),
    ).toEqual({ kind: "warning", reason: "uber-direct-degraded" });
  });

  it("Uber down + click & collect SEUL (pas de livraison déclarée) → none (l'app ne sert pas la livraison)", () => {
    // Un resto qui ne fait QUE du C&C n'a pas besoin d'Uber Direct — pas
    // d'alerte. La frontière Uber n'a de sens que si la livraison est
    // déclarée.
    expect(
      decideTenantStatus({
        stripeStatus: "ready",
        uberDirectConfigured: false,
        acceptedModes: { delivery: false, clickAndCollect: true },
        tenantStatus: "active",
      }),
    ).toEqual({ kind: "none" });
  });

  it("Uber configured + livraison seule active → none (l'happy path nominal)", () => {
    expect(
      decideTenantStatus({
        stripeStatus: "ready",
        uberDirectConfigured: true,
        acceptedModes: { delivery: true, clickAndCollect: false },
        tenantStatus: "active",
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("#411 decideTenantStatus — tenant lifecycle status", () => {
  it("tenantStatus `pending` (statut tenant incomplet) → WARNING tenant-incomplete", () => {
    expect(
      decideTenantStatus({ ...baseHealthy, tenantStatus: "pending" }),
    ).toEqual({ kind: "warning", reason: "tenant-incomplete" });
  });

  it("tenantStatus `suspended` → WARNING tenant-incomplete", () => {
    expect(
      decideTenantStatus({ ...baseHealthy, tenantStatus: "suspended" }),
    ).toEqual({ kind: "warning", reason: "tenant-incomplete" });
  });

  it("tenantStatus `disabled` → WARNING tenant-incomplete (lifecycle, NOT Stripe disabled)", () => {
    // The lifecycle `disabled` is a TENANT KB-Ops suspension, orthogonal to
    // the Stripe `disabled` from §2. Both can co-exist; this test pins the
    // tenant-lifecycle branch with Stripe healthy.
    expect(
      decideTenantStatus({ ...baseHealthy, tenantStatus: "disabled" }),
    ).toEqual({ kind: "warning", reason: "tenant-incomplete" });
  });
});

describe("#411 decideTenantStatus — loading state guards", () => {
  it("stripeStatus null (Convex sub still loading) → none", () => {
    expect(decideTenantStatus({ ...baseHealthy, stripeStatus: null })).toEqual({
      kind: "none",
    });
  });

  it("acceptedModes null (fresh tenant, wizard step 4 not done) → none", () => {
    expect(decideTenantStatus({ ...baseHealthy, acceptedModes: null })).toEqual(
      { kind: "none" },
    );
  });

  it("tenantStatus null (sub loading) → none", () => {
    expect(decideTenantStatus({ ...baseHealthy, tenantStatus: null })).toEqual({
      kind: "none",
    });
  });

  it("all inputs null → none (don't flash anything on cold sub)", () => {
    expect(
      decideTenantStatus({
        stripeStatus: null,
        uberDirectConfigured: false,
        acceptedModes: null,
        tenantStatus: null,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("#411 decideTenantStatus — priority hierarchy combinations", () => {
  it("Multiple WARNINGS at once → Stripe KYC pending wins over Uber dégradé", () => {
    // The truth table orders Stripe KYC BEFORE Uber degraded — pinning that.
    expect(
      decideTenantStatus({
        stripeStatus: "pending",
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: true },
        tenantStatus: "active",
      }),
    ).toEqual({ kind: "warning", reason: "stripe-kyc-pending" });
  });

  it("Multiple WARNINGS at once → Uber dégradé wins over tenant-incomplete", () => {
    expect(
      decideTenantStatus({
        stripeStatus: "ready",
        uberDirectConfigured: false,
        acceptedModes: { delivery: true, clickAndCollect: true },
        tenantStatus: "pending",
      }),
    ).toEqual({ kind: "warning", reason: "uber-direct-degraded" });
  });
});
