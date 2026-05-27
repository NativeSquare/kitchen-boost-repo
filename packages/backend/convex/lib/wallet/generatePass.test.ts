import { convexTest } from "convex-test";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { WALLET_CARD_NAME, WALLET_PASS_TYPE_IDENTIFIER } from "./index";

// Module keys for convex-test: array-negation glob + normalise the same-dir "./x"
// keys into the convex/lib/wallet/** path the harness expects.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/wallet/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.8-A — `generatePass` `"use node"` action, written BEFORE the implementation
 * (TDD red). Generates the COMMON neutral Wallet card (ADR 0003) for the caller's
 * OWN Customer fiche (scope self) in both ecosystems, then persists the technical
 * pass state + audits it.
 *
 * The REAL `.pkpass` PKCS#7 signature needs the prod Apple certs (HITL, POC #3 +
 * device e2e — not in CI), so here we assert the STRUCTURE (Apple `pass.json`,
 * Google save link + a VERIFIABLE RS256 JWT signed with a THROWAWAY generated SA
 * key — never a real secret). The Google JWT signing path runs for real (Node
 * `crypto`, `"use node"`), proving the chain end-to-end exactly like the POC.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const GOOGLE_ISSUER_ID = "3388000000022222222";

/** A throwaway Google service-account JSON (generated key — NEVER a real secret). */
function throwawayServiceAccountJson(): {
  json: string;
  publicKey: crypto.KeyObject;
} {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const json = JSON.stringify({
    type: "service_account",
    project_id: "kitchen-boost",
    client_email: "kitchenboost-wallet@kitchen-boost.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
  return { json, publicKey };
}

/** Verify a Google "Save to Wallet" JWT against the throwaway public key. */
function verifyJwt(jwt: string, publicKey: crypto.KeyObject): boolean {
  const [h, p, s] = jwt.split(".");
  return crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${h}.${p}`),
    publicKey,
    Buffer.from(s, "base64url"),
  );
}

function decodeClaims(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
}

async function seedCustomerForUser(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
): Promise<Id<"customers">> {
  return t.run(async (ctx) =>
    ctx.db.insert("customers", { userId, createdAt: Date.now() }),
  );
}

describe("2.8-A generatePass — common neutral card, both ecosystems (ADR 0003)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let eaterUser: Id<"users">;
  let customerId: Id<"customers">;
  let publicKey: crypto.KeyObject;

  beforeEach(async () => {
    const sa = throwawayServiceAccountJson();
    publicKey = sa.publicKey;
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = Buffer.from(
      sa.json,
    ).toString("base64");
    process.env.GOOGLE_WALLET_ISSUER_ID = GOOGLE_ISSUER_ID;
    // No real Apple cert in CI — the action returns the unsigned Apple structure.
    delete process.env.WALLET_PASS_CERT_P12_BASE64;
    delete process.env.WALLET_PASS_CERT_PASSWORD;

    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    eaterUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "eater@x.fr", role: "customer" }),
    );
    customerId = await seedCustomerForUser(t, eaterUser);
  });

  afterEach(() => {
    delete process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_WALLET_ISSUER_ID;
  });

  it("returns the Apple pass.json structure with the FIXED passTypeIdentifier + the serial", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(api.lib.wallet.generatePass.generatePass, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(res.applePass.passTypeIdentifier).toBe(WALLET_PASS_TYPE_IDENTIFIER);
    expect(res.serialNumber).toBe(res.applePass.serialNumber);
    expect(res.serialNumber.length).toBeGreaterThan(8);
    // Neutral common card — the footer carries "Membre [Nom carte]".
    expect(JSON.stringify(res.applePass)).toContain(
      `Membre ${WALLET_CARD_NAME}`,
    );
  });

  it("shows the brand resto (lastBrandTenantId) as the visible header brand", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(api.lib.wallet.generatePass.generatePass, {
      tenantId: seed.tenantA.tenantId,
      brandTenantId: seed.tenantA.tenantId,
    });
    expect(JSON.stringify(res.applePass.generic.headerFields)).toContain(
      seed.tenantA.name,
    );
  });

  it("returns a Google Wallet save link wrapping a VERIFIABLE RS256 JWT", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(api.lib.wallet.generatePass.generatePass, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(res.googleSaveLink).toMatch(
      /^https:\/\/pay\.google\.com\/gp\/v\/save\//,
    );
    const jwt = res.googleSaveLink.split("/save/")[1];
    expect(jwt.split(".")).toHaveLength(3);
    // The JWT really verifies against the throwaway SA public key (signing path
    // ran for real in "use node" — POC parity).
    expect(verifyJwt(jwt, publicKey)).toBe(true);
    const claims = decodeClaims(jwt);
    expect(claims.aud).toBe("google");
    expect(claims.typ).toBe("savetowallet");
  });

  it("persists the technical pass row (by_serial), status=generated, brand usage", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(api.lib.wallet.generatePass.generatePass, {
      tenantId: seed.tenantA.tenantId,
      brandTenantId: seed.tenantA.tenantId,
    });
    const pass = await t.run(async (ctx) =>
      ctx.db
        .query("walletPasses")
        .withIndex("by_serial", (q) => q.eq("serialNumber", res.serialNumber))
        .unique(),
    );
    expect(pass).not.toBeNull();
    expect(pass?.customerId).toBe(customerId);
    expect(pass?.passTypeIdentifier).toBe(WALLET_PASS_TYPE_IDENTIFIER);
    expect(pass?.status).toBe("generated");
    expect(pass?.lastBrandTenantId).toBe(seed.tenantA.tenantId);
  });

  it("audits the generation (logAudit, US 24)", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(api.lib.wallet.generatePass.generatePass, {
      tenantId: seed.tenantA.tenantId,
    });
    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "wallet.pass.generate"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].targetType).toBe("walletPass");
    expect(audits[0].targetId).toBe(res.serialNumber);
  });

  it("refuses an anonymous caller (customer scope) — no pass created", async () => {
    await expect(
      t.action(api.lib.wallet.generatePass.generatePass, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
    const passes = await t.run(async (ctx) =>
      ctx.db.query("walletPasses").collect(),
    );
    expect(passes).toEqual([]);
  });

  it("refuses a PRO caller (kb_manager is not a customer)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.action(api.lib.wallet.generatePass.generatePass, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Secrets never leave the server (US 22) — no query returns the Wallet secrets
// ---------------------------------------------------------------------------

describe("2.8-A wallet secrets — never exposed to the client (US 22)", () => {
  it("generatePass returns the pass STRUCTURE only — never the cert / SA secret material", async () => {
    const sa = throwawayServiceAccountJson();
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = Buffer.from(
      sa.json,
    ).toString("base64");
    process.env.GOOGLE_WALLET_ISSUER_ID = GOOGLE_ISSUER_ID;
    // A throwaway Apple passphrase the result must never echo back.
    process.env.WALLET_PASS_CERT_PASSWORD = "throwaway-passphrase-secret";

    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const eaterUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "eater@x.fr", role: "customer" }),
    );
    await seedCustomerForUser(t, eaterUser);

    const res = await t
      .withIdentity({ subject: eaterUser })
      .action(api.lib.wallet.generatePass.generatePass, {
        tenantId: seed.tenantA.tenantId,
      });

    // The signed JWT is in the link, but NONE of the raw secret material (the SA
    // private key, the Apple passphrase) is in the returned payload — secrets stay
    // server-side (read from env, never returned to the client).
    const flat = JSON.stringify(res);
    expect(flat).not.toContain("throwaway-passphrase-secret");
    expect(flat).not.toContain("PRIVATE KEY");

    delete process.env.WALLET_PASS_CERT_PASSWORD;
    delete process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_WALLET_ISSUER_ID;
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz (ADR 0010) — the self-scope guard throws for every attacker
// ---------------------------------------------------------------------------

describe("2.8-A generatePass — cross-tenant fuzz (ADR 0010)", () => {
  it("the pass-context guard query throws for every unauthorized actor", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    await t.run(async (ctx) =>
      ctx.db.insert("customers", {
        userId: seed.customerId,
        createdAt: Date.now(),
      }),
    );

    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.wallet.passDb.resolveOwnPassContext],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(leaks).toEqual([]);
  });
});
