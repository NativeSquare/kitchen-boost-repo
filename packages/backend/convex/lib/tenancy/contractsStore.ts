import type { Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { contractPrestation, contractStatus } from "../../table/contracts";

/**
 * 2.9-D — the SANCTIONED data-access seam for the KB-ADMIN-GLOBAL `contracts`
 * table (ADR 0010 documented exemption, exactly like `prospectsStore.ts` for the
 * GLOBAL `prospects` table).
 *
 * A contract belongs to KB's OWN onboarding pipeline, owned by the `kb_admin`
 * (root) role; it carries NO `tenantId` scoping key (the optional `tenantId` is a
 * BACK-LINK set once provisioned, not a tenancy boundary — table/contracts.ts). It
 * is therefore reached ONLY through the root wrappers (`kbAdminQuery/Mutation`),
 * never raw `ctx.db.query("contracts")` in business code (`no-untenanted-query`,
 * 1.x-H). This file lives in the EXEMPT `convex/lib/tenancy/**` path — the single
 * sanctioned `ctx.db` site for the table — so the business module `lib/admin/**`
 * (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * Helpers do persistence only; the lifecycle GUARD (legal-transition assertion)
 * lives in the business module (`lib/admin/contracts.ts`) so the seam stays a
 * dumb store and the decision is testable in isolation (`lib/admin/lifecycle.ts`).
 */

type ContractPrestation = Infer<typeof contractPrestation>;
type ContractStatus = Infer<typeof contractStatus>;

/** The fields needed to insert a freshly-generated `draft` contract. */
export type NewContract = {
  prospectId: Id<"prospects">;
  prestation: ContractPrestation;
  htmlContent: string;
};

/**
 * Insert a generated contract as a `draft`, stamping `statusUpdatedAt` (PRD 70
 * §3.5: status is "daté") + `createdAt`/`updatedAt`. Returns the new row id.
 */
export async function insertContract(
  ctx: MutationCtx,
  body: NewContract,
): Promise<Id<"contracts">> {
  const now = Date.now();
  return ctx.db.insert("contracts", {
    prospectId: body.prospectId,
    prestation: body.prestation,
    status: "draft",
    statusUpdatedAt: now,
    htmlContent: body.htmlContent,
    createdAt: now,
    updatedAt: now,
  });
}

/** Read one contract by id, or `null` if it vanished. */
export async function getContract(
  ctx: QueryCtx | MutationCtx,
  contractId: Id<"contracts">,
): Promise<Doc<"contracts"> | null> {
  return ctx.db.get(contractId);
}

/** Read one contract by id, throwing `NOT_FOUND` if absent (mutation guard). */
export async function requireContract(
  ctx: QueryCtx | MutationCtx,
  contractId: Id<"contracts">,
): Promise<Doc<"contracts">> {
  const contract = await ctx.db.get(contractId);
  if (contract === null) {
    throw new Error("Contract not found.");
  }
  return contract;
}

/** List a prospect's contracts via the `by_prospect` index (PRD 70 §3.5). */
export async function listContractsForProspect(
  ctx: QueryCtx | MutationCtx,
  prospectId: Id<"prospects">,
): Promise<Doc<"contracts">[]> {
  return ctx.db
    .query("contracts")
    .withIndex("by_prospect", (q) => q.eq("prospectId", prospectId))
    .collect();
}

/**
 * Set a contract's lifecycle `status`, re-stamping `statusUpdatedAt` to the
 * instant the new status was reached (PRD 70 §3.5 "statut … daté"). Optionally
 * attaches the `odooLink` (set when the contract is sent). Bumps `updatedAt`. The
 * caller (business module) has already asserted the transition is legal.
 */
export async function setContractStatus(
  ctx: MutationCtx,
  contractId: Id<"contracts">,
  status: ContractStatus,
  patch: { odooLink?: string } = {},
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(contractId, {
    status,
    statusUpdatedAt: now,
    updatedAt: now,
    ...(patch.odooLink !== undefined ? { odooLink: patch.odooLink } : {}),
  });
}
