import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/uberDirect/, so normalise every key to be relative to the convex
// root (../../) so convex-test's findModulesRoot has ONE common prefix (same
// shape as the tenancy / crypto / pricing suites in 1.x-C / 1.x-E / 2.4-B).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/uberDirect/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.6-A — Uber Direct per-tenant credential storage, written BEFORE the
 * implementation (TDD red). REUSES the foundation crypto seam (1.x-E): the
 * structured Uber credential (clientId / clientSecret / customerId +
 * webhookSigningKey?) is JSON-serialised, sealed with `encryptForTenant`, and
 * upserted into the EXISTING `tenantCredentials` row `provider = "uber_direct"`.
 * Decryption happens ONLY inside an action. Writing the credential also links the
 * tenant to its Uber sub-account via `tenants.uberCustomerId`, and is AUDITED.
 *
 * Field names (clientId / clientSecret / customerId / webhookSigningKey) are the
 * documented Uber Direct credentials — research/uber_direct_deep_dive §1.1 / §3.1
 * (`client_id`, `client_secret`, `customer_id`, webhook signing key) — not
 * invented.
 *
 * `KMS_MASTER_KEY` is injected by `test.setup.ts` (a throw-away test key).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const CREDS = {
  clientId: "kb-parent-client-id",
  clientSecret: "sk_live_uber_secret_999",
  customerId: "cus_uber_A",
  webhookSigningKey: "whsec_uber_signing_key",
};

describe("2.6-A Uber credentials — store (encrypted) + decrypt-in-action round-trip", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("a kb_manager stores Uber credentials, then an action decrypts them back", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    const stored = await asManager.mutation(
      api.lib.uberDirect.credentials.setUberCredentials,
      { tenantId: seed.tenantA.tenantId, credentials: CREDS },
    );
    // The store mutation NEVER echoes the secret back.
    expect(JSON.stringify(stored)).not.toContain("sk_live_uber_secret_999");

    const decrypted = await asManager.action(
      api.lib.uberDirect.credentials.getDecryptedUberCredentials,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(decrypted).toEqual(CREDS);
  });

  it("links the tenant to its Uber sub-account via tenants.uberCustomerId", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });

    const tenant = await t.run(async (ctx) =>
      ctx.db.get(seed.tenantA.tenantId),
    );
    expect(tenant?.uberCustomerId).toBe("cus_uber_A");
  });

  it("persists ONLY the encrypted envelope (no plaintext secret) in tenantCredentials", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("tenantCredentials")
        .withIndex("by_tenant_provider", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("provider", "uber_direct"),
        )
        .unique(),
    );
    expect(row).not.toBeNull();
    expect(row?.keyVersion).toBe(1);
    expect(typeof row?.ciphertext).toBe("string");
    // The stored row holds NO plaintext secret anywhere.
    expect(JSON.stringify(row)).not.toContain("sk_live_uber_secret_999");
    expect(JSON.stringify(row)).not.toContain("whsec_uber_signing_key");
  });

  it("rotation re-stores in place (no duplicate row; latest value wins)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(
      api.lib.uberDirect.credentials.setUberCredentials,
      { tenantId: seed.tenantA.tenantId, credentials: CREDS },
    );
    const rotated = { ...CREDS, clientSecret: "sk_live_rotated_000" };
    await asManager.mutation(
      api.lib.uberDirect.credentials.setUberCredentials,
      { tenantId: seed.tenantA.tenantId, credentials: rotated },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("tenantCredentials")
        .withIndex("by_tenant_provider", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("provider", "uber_direct"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);

    const decrypted = await asManager.action(
      api.lib.uberDirect.credentials.getDecryptedUberCredentials,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(decrypted.clientSecret).toBe("sk_live_rotated_000");
  });

  it("writing credentials is audited via logAudit", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect(),
    );
    const entry = audits.find((a) => a.action === "uber.credentials.set");
    expect(entry).toBeDefined();
    // The audit row never contains the secret.
    expect(JSON.stringify(entry)).not.toContain("sk_live_uber_secret_999");
  });

  it("a kb_admin (root) can store + decrypt on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.uberDirect.credentials.setUberCredentials, {
      tenantId: seed.tenantB.tenantId,
      credentials: { ...CREDS, customerId: "cus_uber_B" },
    });
    const decrypted = await asAdmin.action(
      api.lib.uberDirect.credentials.getDecryptedUberCredentials,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(decrypted.customerId).toBe("cus_uber_B");
  });

  it("decrypting credentials that were never set throws (no silent null secret)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .action(api.lib.uberDirect.credentials.getDecryptedUberCredentials, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow();
  });

  it("staff cannot write Uber credentials (allow: kb_manager only)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.staffId })
        .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
          tenantId: seed.tenantA.tenantId,
          credentials: CREDS,
        }),
    ).rejects.toThrow();
  });
});

describe("2.6-A MOAT — there is NO exposed query that decrypts Uber credentials", () => {
  it("decrypt is action-only — type-level", () => {
    type UberApi = typeof import("./index");
    // @ts-expect-error getDecryptedUberCredentialsQuery does not exist — decrypt is action-only.
    type _NoQuery = UberApi["getDecryptedUberCredentialsQuery"];
    expect(true).toBe(true);
  });
});

describe("2.6-A cross-tenant fuzz — Uber credential wrappers, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
  });

  it("the credential write + blob read reject every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.uberDirect.credentials.setUberCredentials,
        api.lib.uberDirect.credentials.getUberCredentialBlob,
      ],
      isQuery: (fn) => fn !== api.lib.uberDirect.credentials.setUberCredentials,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { credentials: CREDS },
    });
    expect(pairs).toBe(12);
    expect(leaks).toEqual([]);
  });
});
