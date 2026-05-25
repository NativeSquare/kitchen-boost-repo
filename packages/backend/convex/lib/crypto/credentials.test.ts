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
// convex/lib/crypto/, so normalise every key to be relative to the convex root
// (../../) so convex-test's findModulesRoot has ONE common prefix (same shape as
// the tenancy suites in 1.x-C / 1.x-D).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/crypto/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 1.x-E — per-tenant secret storage (Uber Direct credentials), written BEFORE
 * the implementation (TDD red). Built on the tenancy wrappers (1.x-C): the
 * credential is stored via a GUARDED `tenantMutation`, the encrypted blob is
 * read via a GUARDED `tenantQuery`, and DECRYPTION happens ONLY inside an
 * `action` (`getDecryptedTenantCredential`) — never through an exposed query.
 *
 * `KMS_MASTER_KEY` is injected by `test.setup.ts` (a throw-away test key).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PROVIDER = "uber_direct";
const SECRET = "uber-direct:customer_id=cus_42;client_secret=sk_live_abc123";

describe("1.x-E store + decrypt-in-action round-trip (guarded wrappers)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("a kb_manager stores an uber_direct credential, then an action decrypts it back to the original", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    const stored = await asManager.mutation(
      api.lib.crypto.credentials.storeTenantCredential,
      {
        tenantId: seed.tenantA.tenantId,
        provider: PROVIDER,
        plaintext: SECRET,
      },
    );
    // The store mutation NEVER echoes the plaintext back.
    expect(JSON.stringify(stored)).not.toContain("sk_live_abc123");

    // Decryption lives ONLY in the action.
    const decrypted = await asManager.action(
      api.lib.crypto.credentials.getDecryptedTenantCredential,
      { tenantId: seed.tenantA.tenantId, provider: PROVIDER },
    );
    expect(decrypted).toBe(SECRET);
  });

  it("persists the GCM params + keyVersion and NEVER the plaintext in the row", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.crypto.credentials.storeTenantCredential, {
        tenantId: seed.tenantA.tenantId,
        provider: PROVIDER,
        plaintext: SECRET,
      });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("tenantCredentials")
        .withIndex("by_tenant_provider", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("provider", PROVIDER),
        )
        .unique(),
    );
    expect(row).not.toBeNull();
    expect(row?.keyVersion).toBe(1);
    expect(typeof row?.ciphertext).toBe("string");
    expect(typeof row?.iv).toBe("string");
    expect(typeof row?.authTag).toBe("string");
    // The stored row holds NO plaintext anywhere.
    expect(JSON.stringify(row)).not.toContain("sk_live_abc123");
  });

  it("re-storing the same provider upserts (no duplicate rows; latest value wins)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.crypto.credentials.storeTenantCredential, {
      tenantId: seed.tenantA.tenantId,
      provider: PROVIDER,
      plaintext: "old-secret",
    });
    await asManager.mutation(api.lib.crypto.credentials.storeTenantCredential, {
      tenantId: seed.tenantA.tenantId,
      provider: PROVIDER,
      plaintext: "new-secret",
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("tenantCredentials")
        .withIndex("by_tenant_provider", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("provider", PROVIDER),
        )
        .collect(),
    );
    expect(rows.length).toBe(1);

    const decrypted = await asManager.action(
      api.lib.crypto.credentials.getDecryptedTenantCredential,
      { tenantId: seed.tenantA.tenantId, provider: PROVIDER },
    );
    expect(decrypted).toBe("new-secret");
  });

  it("a kb_admin (root) can store + decrypt on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.crypto.credentials.storeTenantCredential, {
      tenantId: seed.tenantB.tenantId,
      provider: PROVIDER,
      plaintext: SECRET,
    });
    const decrypted = await asAdmin.action(
      api.lib.crypto.credentials.getDecryptedTenantCredential,
      { tenantId: seed.tenantB.tenantId, provider: PROVIDER },
    );
    expect(decrypted).toBe(SECRET);
  });

  it("decrypting a missing credential throws (no silent null secret)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .action(api.lib.crypto.credentials.getDecryptedTenantCredential, {
          tenantId: seed.tenantA.tenantId,
          provider: PROVIDER,
        }),
    ).rejects.toThrow();
  });
});

describe("1.x-E MOAT — the plaintext secret never transits an exposed query", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.crypto.credentials.storeTenantCredential, {
        tenantId: seed.tenantA.tenantId,
        provider: PROVIDER,
        plaintext: SECRET,
      });
  });

  it("the guarded blob query returns ONLY the encrypted fields, never the plaintext", async () => {
    const blob = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.crypto.credentials.getTenantCredentialBlob, {
        tenantId: seed.tenantA.tenantId,
        provider: PROVIDER,
      });
    expect(blob).not.toBeNull();
    expect(JSON.stringify(blob)).not.toContain("sk_live_abc123");
    // It surfaces the ciphertext envelope, not a decrypted value.
    expect(blob?.ciphertext).toBeTypeOf("string");
    expect(blob?.keyVersion).toBe(1);
    // No `plaintext` / `decrypted` field is exposed.
    expect((blob as Record<string, unknown>).plaintext).toBeUndefined();
    expect((blob as Record<string, unknown>).decrypted).toBeUndefined();
  });

  it("there is NO exposed query that decrypts (decrypt is action-only) — type-level", () => {
    type Creds = typeof import("./index");
    // @ts-expect-error decryptTenantCredentialQuery does not exist — decrypt is action-only.
    type _NoDecryptQuery = Creds["decryptTenantCredentialQuery"];
    expect(true).toBe(true);
  });
});

describe("1.x-E cross-tenant fuzz — credential wrappers, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Seed a credential on tenant A so the read path has something to (not) leak.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.crypto.credentials.storeTenantCredential, {
        tenantId: seed.tenantA.tenantId,
        provider: PROVIDER,
        plaintext: SECRET,
      });
  });

  it("the guarded store + blob-read reject every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.crypto.credentials.storeTenantCredential,
        api.lib.crypto.credentials.getTenantCredentialBlob,
      ],
      isQuery: (fn) => fn !== api.lib.crypto.credentials.storeTenantCredential,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { provider: PROVIDER, plaintext: SECRET },
    });
    expect(pairs).toBe(10);
    expect(leaks).toEqual([]);
  });
});
