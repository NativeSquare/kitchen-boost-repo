import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/printing/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * #412 — Star Micronics WebPRNT printer config tenant-scoped persistence
 * (PRD 20 §14 + kb-orders CONTEXT « Impression thermique cuisine »).
 *
 * The backend slice is intentionally minimal — the LAN-only HTTP POST to the
 * Star printer happens CLIENT-SIDE in the native app (the printer is
 * unreachable from Convex's cloud workers), so all the backend owns is:
 *
 *   - `getPrinterConfig`    — operational read of the URL or `null`
 *   - `setPrinterConfig`    — gérant writes a non-empty `starWebPrntUrl`
 *   - `clearPrinterConfig`  — gérant removes the printer (auto-print becomes
 *                             a clean no-op again)
 *
 * The native auto-print at `acknowledge` reads `getPrinterConfig`, builds an
 * ESC/POS payload from the `OrderWithDetail` (already returned by `getOrder`),
 * and POSTs it fire-and-forget. The tests below pin the tenancy + validation
 * contract — the ESC/POS payload is pinned in the native vitest suite
 * (`apps/native/src/lib/printing/decide-star-printer.test.ts`).
 *
 * ── Why state-Convex partagé matters (PRD 20 §14) ─────────────────────────
 * The URL persists on `tenants.printerConfig.starWebPrntUrl`, so KB Admin
 * (#416) AND KB Orders Settings (#412 / #418) write through the SAME field.
 * A change on either surface flips the other live through the Convex sub.
 * The CROSS-TENANT FUZZ at the bottom proves a foreign tenant never reads or
 * writes another's printer (ADR 0010).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("#412 printerConfig — tenant-scoped persistence (PRD 20 §14)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("get returns null when no printer is configured on the tenant (default)", async () => {
    const config = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.printing.printing.getPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(config).toBeNull();
  });

  it("sets a Star WebPRNT URL on the calling tenant, then clears it", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const url = "http://192.168.1.42/StarWebPRNT/SendMessage";

    await asManager.mutation(api.lib.printing.printing.setPrinterConfig, {
      tenantId: seed.tenantA.tenantId,
      starWebPrntUrl: url,
    });
    let config = await asManager.query(
      api.lib.printing.printing.getPrinterConfig,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(config?.starWebPrntUrl).toBe(url);

    await asManager.mutation(api.lib.printing.printing.clearPrinterConfig, {
      tenantId: seed.tenantA.tenantId,
    });
    config = await asManager.query(api.lib.printing.printing.getPrinterConfig, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(config).toBeNull();
  });

  it("overwrites an existing URL when set is called twice (gérant fixed a typo)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.printing.printing.setPrinterConfig, {
      tenantId: seed.tenantA.tenantId,
      starWebPrntUrl: "http://192.168.1.41/StarWebPRNT/SendMessage",
    });
    await asManager.mutation(api.lib.printing.printing.setPrinterConfig, {
      tenantId: seed.tenantA.tenantId,
      starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
    });
    const config = await asManager.query(
      api.lib.printing.printing.getPrinterConfig,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(config?.starWebPrntUrl).toBe(
      "http://192.168.1.42/StarWebPRNT/SendMessage",
    );
  });

  it("rejects an empty starWebPrntUrl (a blank string would silently mean « no printer »)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.printing.printing.setPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
        starWebPrntUrl: "",
      }),
    ).rejects.toThrow();
    // Whitespace-only is the same UX bug — a tab + spaces also throws.
    await expect(
      asManager.mutation(api.lib.printing.printing.setPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
        starWebPrntUrl: "   \t  ",
      }),
    ).rejects.toThrow();
  });

  it("rejects a URL that is not http:// or https:// (a bare IP or javascript: scheme)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Bare IP — gérant pasted only the address (no scheme). PRD 20 §14
    // documents the canonical URL « http://<ip>/StarWebPRNT/SendMessage », so
    // we surface the validation upstream rather than fail silently on the
    // network POST.
    await expect(
      asManager.mutation(api.lib.printing.printing.setPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
        starWebPrntUrl: "192.168.1.42",
      }),
    ).rejects.toThrow();
    // Same scheme guard rejects unsafe schemes pasted by mistake.
    await expect(
      asManager.mutation(api.lib.printing.printing.setPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
        starWebPrntUrl: "javascript:alert(1)",
      }),
    ).rejects.toThrow();
  });

  it("staff (operational) can read the printer config but NOT set or clear it (gérant action)", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.printing.printing.setPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
        starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
      });

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });

    // Staff reads OK (the kitchen tablet under audit monolithique V1 reads
    // the same config the gérant set on her phone).
    const config = await asStaff.query(
      api.lib.printing.printing.getPrinterConfig,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(config?.starWebPrntUrl).toBe(
      "http://192.168.1.42/StarWebPRNT/SendMessage",
    );

    // But staff cannot toggle the configuration — same access as the other
    // gérant-only writes (Pause, Closure, ItemAvailability) which all reject
    // staff at the wrapper level.
    await expect(
      asStaff.mutation(api.lib.printing.printing.setPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
        starWebPrntUrl: "http://192.168.1.99/StarWebPRNT/SendMessage",
      }),
    ).rejects.toThrow();
    await expect(
      asStaff.mutation(api.lib.printing.printing.clearPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("setting tenant A's printer does not leak onto tenant B (independent field per tenant, ADR 0010)", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.printing.printing.setPrinterConfig, {
        tenantId: seed.tenantA.tenantId,
        starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
      });

    const bConfig = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.printing.printing.getPrinterConfig, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bConfig).toBeNull();
  });
});

describe("#412 printerConfig — cross-tenant fuzz, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("every printerConfig function rejects every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.printing.printing.getPrinterConfig,
        api.lib.printing.printing.setPrinterConfig,
        api.lib.printing.printing.clearPrinterConfig,
      ],
      isQuery: (fn) => fn === api.lib.printing.printing.getPrinterConfig,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {
        // Valid URL so the fuzz pins AUTH refusal, not validation. The
        // wrapper rejects upstream of the validator, so the value is never
        // actually persisted — but supplying garbage would short-circuit the
        // distinction we want.
        starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
      },
    });
    expect(pairs).toBe(15);
    expect(leaks).toEqual([]);
  });
});
