import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * #393 — `devices` module tests (TDD red).
 *
 * Pins the contract of the (user, device) preference seam that drives the KB
 * Orders first-login kiosque/téléphone toggle (PRD 20 §1a step 3, §12), the
 * kiosque `pinnedTenantId` (#399 reads it to hide the switcher + audit
 * monolithique V1), the phone-mode `lastSelectedTenantId` (#399 hydrates the
 * switcher), and the `onboardingCompleted` skip flag.
 *
 * Two guardrails are PINNED here in the same suite (story acceptance criteria
 * + KitchenBoost guardrails):
 *
 *  - **Self-scope** — `getMyDevice` returns ONLY the caller's row; `setMyDeviceMode`
 *    writes ONLY the caller's row. An unauthenticated caller throws.
 *  - **Cross-tenant fuzz on `pinnedTenantId`** — a kb_manager of tenant A who
 *    tries to pin to tenant B is rejected with Forbidden (no `userTenants`
 *    attachment, no access). This is the ADR 0010 third line of defence for
 *    this story: a leaky setter would silently anchor a user to a tenant they
 *    cannot see, which would then leak through #399's switcher logic.
 */

// Same module-glob trick as withTenant.test.ts (the file lives 2 levels deep,
// vitest needs every key normalised relative to the convex root).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/devices/${path.slice(2)}` : path,
    loader,
  ]),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("#393 devices.getMyDevice — self-scoped read", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated when no caller identity", async () => {
    await expect(
      t.query(api.lib.devices.devices.getMyDevice, { deviceId: "dev-x" }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("returns null when the caller has no row for that deviceId yet (first launch)", async () => {
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.devices.devices.getMyDevice, { deviceId: "fresh-device" });
    expect(res).toBeNull();
  });

  it("returns the caller's OWN row for a known deviceId", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "tab-1",
      mode: "telephone",
    });

    const row = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "tab-1",
    });
    expect(row).not.toBeNull();
    expect(row?.mode).toBe("telephone");
    expect(row?.pinnedTenantId).toBeUndefined();
    expect(row?.userId).toBe(seed.tenantA.managerId);
  });

  it("never leaks another user's row, even with the same deviceId string", async () => {
    // Manager A writes a row.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.devices.devices.setMyDeviceMode, {
        deviceId: "shared-device-id",
        mode: "telephone",
      });

    // Manager B asks for the SAME deviceId string — they own NO row, get null.
    const peek = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.devices.devices.getMyDevice, {
        deviceId: "shared-device-id",
      });
    expect(peek).toBeNull();
  });
});

describe("#393 devices.setMyDeviceMode — first-launch + re-launch (E2E roundtrip)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated when no caller identity", async () => {
    await expect(
      t.mutation(api.lib.devices.devices.setMyDeviceMode, {
        deviceId: "dev-x",
        mode: "telephone",
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("E2E premier launch → choix kiosque → re-launch → tenant pinné (AC1)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });

    // First launch: device row absent.
    expect(
      await asA.query(api.lib.devices.devices.getMyDevice, {
        deviceId: "tablet-kitchen-1",
      }),
    ).toBeNull();

    // User picks kiosque AND pins to tenant A.
    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "tablet-kitchen-1",
      mode: "kiosque",
      pinnedTenantId: seed.tenantA.tenantId,
    });

    // Re-launch: the device row is hydrated with the kiosque pin.
    const reloaded = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "tablet-kitchen-1",
    });
    expect(reloaded?.mode).toBe("kiosque");
    expect(reloaded?.pinnedTenantId).toBe(seed.tenantA.tenantId);
  });

  it("E2E premier launch → choix téléphone → re-launch → pas de pinning (switcher visible)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });

    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "phone-mgr-1",
      mode: "telephone",
    });

    const reloaded = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "phone-mgr-1",
    });
    expect(reloaded?.mode).toBe("telephone");
    // Phone mode = pas de pin. #399 lit ce champ pour décider de l'affichage
    // du switcher.
    expect(reloaded?.pinnedTenantId).toBeUndefined();
  });

  it("re-call upserts the SAME row (no duplicate) and updates the mode", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });

    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "switchable",
      mode: "telephone",
    });
    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "switchable",
      mode: "kiosque",
      pinnedTenantId: seed.tenantA.tenantId,
    });

    const after = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "switchable",
    });
    expect(after?.mode).toBe("kiosque");
    expect(after?.pinnedTenantId).toBe(seed.tenantA.tenantId);

    // No duplicate row was created.
    const allOwn = await t.run(async (ctx) =>
      ctx.db
        .query("devices")
        .withIndex("by_user_device", (q) =>
          q.eq("userId", seed.tenantA.managerId).eq("deviceId", "switchable"),
        )
        .collect(),
    );
    expect(allOwn).toHaveLength(1);
  });

  it("re-baselining from kiosque → téléphone CLEARS the pin (Settings rebascule, TB-21)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });

    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "rebascule",
      mode: "kiosque",
      pinnedTenantId: seed.tenantA.tenantId,
    });
    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "rebascule",
      mode: "telephone",
    });

    const row = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "rebascule",
    });
    expect(row?.mode).toBe("telephone");
    expect(row?.pinnedTenantId).toBeUndefined();
  });
});

describe("#393 devices.setMyDeviceMode — kiosque cross-tenant access guardrail", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("rejects kiosque mode without pinnedTenantId (invalid combination)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
        deviceId: "tab-no-pin",
        mode: "kiosque",
      }),
    ).rejects.toThrow();
  });

  it("rejects telephone mode WITH a pinnedTenantId (invalid combination)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
        deviceId: "phone-with-pin",
        mode: "telephone",
        pinnedTenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("cross-tenant fuzz: manager A cannot pin to tenant B (no attachment)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
        deviceId: "tab-cross",
        mode: "kiosque",
        pinnedTenantId: seed.tenantB.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);

    // And nothing was written.
    const row = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "tab-cross",
    });
    expect(row).toBeNull();
  });

  it("cross-tenant fuzz: detached user cannot pin to the tenant they lost access to", async () => {
    const asDetached = t.withIdentity({ subject: seed.detachedUserId });
    await expect(
      asDetached.mutation(api.lib.devices.devices.setMyDeviceMode, {
        deviceId: "tab-revoked",
        mode: "kiosque",
        pinnedTenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("kb_admin (root) can pin to ANY tenant — root override (ADR 0011)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "kb-admin-laptop",
      mode: "kiosque",
      pinnedTenantId: seed.tenantB.tenantId,
    });
    const row = await asAdmin.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "kb-admin-laptop",
    });
    expect(row?.pinnedTenantId).toBe(seed.tenantB.tenantId);
  });
});

describe("#393 devices.setMyDeviceLastSelectedTenant — phone-mode switcher hint (#399)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("persists the last selected tenant on a telephone-mode device", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "phone-walid",
      mode: "telephone",
    });
    await asA.mutation(api.lib.devices.devices.setMyDeviceLastSelectedTenant, {
      deviceId: "phone-walid",
      tenantId: seed.tenantA.tenantId,
    });
    const row = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "phone-walid",
    });
    expect(row?.lastSelectedTenantId).toBe(seed.tenantA.tenantId);
  });

  it("cross-tenant fuzz: cannot record a last-selected tenant the user does not have", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "phone-walid",
      mode: "telephone",
    });
    await expect(
      asA.mutation(api.lib.devices.devices.setMyDeviceLastSelectedTenant, {
        deviceId: "phone-walid",
        tenantId: seed.tenantB.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("#393 devices.markOnboardingCompleted — skip flag on re-launch (PRD 20 §1a)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("sets the flag and a subsequent getMyDevice surfaces it (no UI re-prompt)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });

    await asA.mutation(api.lib.devices.devices.setMyDeviceMode, {
      deviceId: "tab-onb",
      mode: "kiosque",
      pinnedTenantId: seed.tenantA.tenantId,
    });
    await asA.mutation(api.lib.devices.devices.markOnboardingCompleted, {
      deviceId: "tab-onb",
    });

    const row = await asA.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "tab-onb",
    });
    expect(row?.onboardingCompleted).toBe(true);
  });
});
