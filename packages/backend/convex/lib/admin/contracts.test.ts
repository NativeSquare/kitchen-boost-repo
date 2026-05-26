import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every key
// to be relative to the convex root (../../) so findModulesRoot has ONE common
// prefix (same shape as the onboarding / pricing suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/admin/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.9-D — contract lifecycle MUTATIONS over the KB-ADMIN-GLOBAL `contracts` table
 * (PRD 70 §3.5, kb-admin CONTEXT), written BEFORE the implementation (TDD red).
 *
 * Contracts are KB's OWN onboarding data (root-only, like `prospects`): every
 * function goes through the ROOT wrappers (`kbAdminQuery` / `kbAdminMutation`),
 * reaches the table ONLY through the sanctioned `lib/tenancy/contractsStore` seam
 * (never raw `ctx.db` in this business module — `no-untenanted-query`, ADR 0010),
 * resolves identity only via the wrapper's `getCurrentActor` (ADR 0011), and is
 * auto-audited by the foundation. The lifecycle `draft → sent → signed` (+
 * `expired`) is enforced — an illegal move is rejected.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PARTNER = {
  raisonSociale: "Buns and Bao SARL",
  siret: "98765432100012",
  adresse: "12 rue de la Paix, 91000 Évry",
  email: "khan@bunsandbao.fr",
  representant: "Khan Diallo",
};

// Seed a prospect directly through the DB (the contract back-link target). We
// insert via `t.run` rather than calling the onboarding CRM mutation so this
// suite has no cross-module function dependency (and a stable module root).
async function seedProspect(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("prospects", {
      name: "Buns and Bao",
      phone: "0612345678",
      phase: "acquisition",
      source: "cold_call",
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("2.9-D contract lifecycle — generate / send / refresh / expire", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("generates a draft contract with rendered HTML, dated", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);

    const contractId = await asAdmin.mutation(
      api.lib.admin.contracts.generateContract,
      { prospectId, prestation: "A_AND_B", partner: PARTNER },
    );
    expect(contractId).toBeTypeOf("string");

    const c = await asAdmin.query(api.lib.admin.contracts.getContract, {
      contractId,
    });
    expect(c?.status).toBe("draft");
    expect(c?.prestation).toBe("A_AND_B");
    expect(c?.prospectId).toBe(prospectId);
    expect(c?.htmlContent).toContain(PARTNER.raisonSociale);
    expect(c?.htmlContent).not.toContain("<!-- BEGIN");
    expect(c?.statusUpdatedAt).toBeTypeOf("number");
    expect(c?.odooLink).toBeUndefined();
  });

  it("sends a draft → sent and attaches the odooLink, re-dating the status", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);
    const contractId = await asAdmin.mutation(
      api.lib.admin.contracts.generateContract,
      { prospectId, prestation: "A", partner: PARTNER },
    );
    const before = await asAdmin.query(api.lib.admin.contracts.getContract, {
      contractId,
    });

    await asAdmin.mutation(api.lib.admin.contracts.sendContract, {
      contractId,
      odooLink: "https://odoo.example/sign/abc",
    });

    const after = await asAdmin.query(api.lib.admin.contracts.getContract, {
      contractId,
    });
    expect(after?.status).toBe("sent");
    expect(after?.odooLink).toBe("https://odoo.example/sign/abc");
    // The status timestamp is re-stamped on transition (PRD 70 §3.5 "daté").
    expect(after?.statusUpdatedAt).toBeGreaterThanOrEqual(
      before?.statusUpdatedAt ?? 0,
    );
  });

  it("refreshContractStatus moves sent → signed (V1 manual check)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);
    const contractId = await asAdmin.mutation(
      api.lib.admin.contracts.generateContract,
      { prospectId, prestation: "B", partner: PARTNER },
    );
    await asAdmin.mutation(api.lib.admin.contracts.sendContract, {
      contractId,
      odooLink: "https://odoo.example/sign/xyz",
    });

    const result = await asAdmin.mutation(
      api.lib.admin.contracts.refreshContractStatus,
      { contractId, signed: true },
    );
    expect(result.status).toBe("signed");

    const c = await asAdmin.query(api.lib.admin.contracts.getContract, {
      contractId,
    });
    expect(c?.status).toBe("signed");
  });

  it("refreshContractStatus leaves status untouched when not yet signed", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);
    const contractId = await asAdmin.mutation(
      api.lib.admin.contracts.generateContract,
      { prospectId, prestation: "B", partner: PARTNER },
    );
    await asAdmin.mutation(api.lib.admin.contracts.sendContract, {
      contractId,
      odooLink: "https://odoo.example/sign/xyz",
    });
    const result = await asAdmin.mutation(
      api.lib.admin.contracts.refreshContractStatus,
      { contractId, signed: false },
    );
    expect(result.status).toBe("sent");
  });

  it("expires a draft / sent contract", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);
    const contractId = await asAdmin.mutation(
      api.lib.admin.contracts.generateContract,
      { prospectId, prestation: "A", partner: PARTNER },
    );
    await asAdmin.mutation(api.lib.admin.contracts.expireContract, {
      contractId,
    });
    const c = await asAdmin.query(api.lib.admin.contracts.getContract, {
      contractId,
    });
    expect(c?.status).toBe("expired");
  });

  it("rejects an illegal transition (signed → expired) — terminal state", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);
    const contractId = await asAdmin.mutation(
      api.lib.admin.contracts.generateContract,
      { prospectId, prestation: "A", partner: PARTNER },
    );
    await asAdmin.mutation(api.lib.admin.contracts.sendContract, {
      contractId,
      odooLink: "https://odoo.example/sign/abc",
    });
    await asAdmin.mutation(api.lib.admin.contracts.refreshContractStatus, {
      contractId,
      signed: true,
    });
    // signed is terminal — expiring it is illegal.
    await expect(
      asAdmin.mutation(api.lib.admin.contracts.expireContract, { contractId }),
    ).rejects.toThrow(/signed.*expired|invalid/i);
  });

  it("rejects sending an already-signed contract (signed → sent illegal)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);
    const contractId = await asAdmin.mutation(
      api.lib.admin.contracts.generateContract,
      { prospectId, prestation: "A", partner: PARTNER },
    );
    await asAdmin.mutation(api.lib.admin.contracts.sendContract, {
      contractId,
      odooLink: "https://odoo.example/sign/abc",
    });
    await asAdmin.mutation(api.lib.admin.contracts.refreshContractStatus, {
      contractId,
      signed: true,
    });
    await expect(
      asAdmin.mutation(api.lib.admin.contracts.sendContract, {
        contractId,
        odooLink: "https://odoo.example/sign/again",
      }),
    ).rejects.toThrow(/signed.*sent|invalid/i);
  });

  it("lists contracts for a prospect", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await seedProspect(t);
    await asAdmin.mutation(api.lib.admin.contracts.generateContract, {
      prospectId,
      prestation: "A",
      partner: PARTNER,
    });
    await asAdmin.mutation(api.lib.admin.contracts.generateContract, {
      prospectId,
      prestation: "B",
      partner: PARTNER,
    });
    const list = await asAdmin.query(
      api.lib.admin.contracts.listContractsForProspect,
      { prospectId },
    );
    expect(list.length).toBe(2);
  });
});

/**
 * Root-only fuzz — `contracts` are KB-admin-GLOBAL (no `tenantId` scoping key),
 * so the relevant isolation property is that EVERY contract function is ROOT-ONLY:
 * every non-root actor (manager / staff / plain customer / detached / anonymous)
 * is rejected (Forbidden), no data leak (ADR 0010). Tenant-less functions are
 * fuzzed with `tenantId: undefined`.
 */
describe("2.9-D contract root-only fuzz — every contract function is kb_admin-gated", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can reach any contract function", async () => {
    const prospectId = await seedProspect(t);
    const contractId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.admin.contracts.generateContract, {
        prospectId,
        prestation: "A",
        partner: PARTNER,
      });

    const queries = [
      api.lib.admin.contracts.getContract,
      api.lib.admin.contracts.listContractsForProspect,
    ];
    const mutations = [
      api.lib.admin.contracts.generateContract,
      api.lib.admin.contracts.sendContract,
      api.lib.admin.contracts.refreshContractStatus,
      api.lib.admin.contracts.expireContract,
    ];
    const isQuery = (fn: unknown) => queries.includes(fn as never);

    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [...queries, ...mutations],
      isQuery,
      tenantId: undefined,
      actors,
      // Args that satisfy each function's validator (the gate fires BEFORE the
      // handler runs, so concrete values only need to pass arg validation).
      extraArgs: {
        contractId,
        prospectId,
        prestation: "A",
        partner: PARTNER,
        odooLink: "https://odoo.example/sign/abc",
        signed: true,
      },
    });
    expect(pairs).toBe(6 * actors.length);
    expect(leaks).toEqual([]);
  });

  it("a non-root caller is rejected with Forbidden", async () => {
    const prospectId = await seedProspect(t);
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.admin.contracts.generateContract, {
          prospectId,
          prestation: "A",
          partner: PARTNER,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});
