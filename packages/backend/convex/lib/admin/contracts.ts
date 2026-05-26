import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { contractPrestation } from "../../table/contracts";
import {
  getContract as getContractRow,
  insertContract,
  kbAdminMutation,
  kbAdminQuery,
  listContractsForProspect as listContractsForProspectRows,
  requireContract,
  setContractStatus,
} from "../tenancy";
import { generateContractHtml } from "./generateContract";
import { assertLegalContractTransition } from "./lifecycle";

/**
 * 2.9-D — contract generation + lifecycle over the KB-ADMIN-GLOBAL `contracts`
 * table (PRD 70 §3.5, kb-admin CONTEXT "Statut contrat" / "Contrat HTML").
 *
 * Contracts are KB's OWN onboarding data, owned by the `kb_admin` (root) role —
 * so EVERY function goes through `kbAdminQuery` / `kbAdminMutation` (root scope);
 * a `kb_manager` / `staff` / `customer` is refused (Forbidden). The table is
 * reached ONLY through the sanctioned `lib/tenancy/contractsStore` seam — never
 * raw `ctx.db` in this business module (`no-untenanted-query`, ADR 0010). Identity
 * flows only through the wrappers' `getCurrentActor` (ADR 0011). Every
 * `kbAdminMutation` is auto-audited by the foundation (STACK.md §6.4).
 *
 * The HTML is produced by the PURE `generateContractHtml` (the TypeScript port of
 * `generate_contract.py` over the canonical `contrat_template.md`); the lifecycle
 * `draft → sent → signed` (+ `expired`) is enforced by `assertLegalContractTransition`
 * (lifecycle.ts) so an illegal move (e.g. `signed → draft`) is rejected, never
 * persisted. Signature itself stays on Odoo (PRD 70 §3.5) — KB only tracks status.
 *
 * Convex registers functions by module PATH, so callers invoke these as
 * `api.lib.admin.contracts.{generateContract,sendContract,refreshContractStatus,
 * expireContract,getContract,listContractsForProspect}`.
 */

/** The Partenaire fiche fields filling the contract (PRD 70 §3.5 "Inputs pré-remplis"). */
const partnerFiche = v.object({
  raisonSociale: v.string(),
  siret: v.string(),
  adresse: v.string(),
  email: v.string(),
  representant: v.string(),
});

/**
 * Generate a contract for a prospect and store it as a `draft` (PRD 70 §3.5).
 * Renders the canonical template (pure port) with the selected `prestation` and
 * the partner fiche. Returns the new contract id.
 */
export const generateContract = kbAdminMutation({
  args: {
    prospectId: v.id("prospects"),
    prestation: contractPrestation,
    partner: partnerFiche,
  },
  action: "contract.generate",
  handler: async (ctx, args): Promise<Id<"contracts">> => {
    const htmlContent = generateContractHtml({
      prestation: args.prestation,
      partner: args.partner,
    });
    return insertContract(ctx, {
      prospectId: args.prospectId,
      prestation: args.prestation,
      htmlContent,
    });
  },
});

/**
 * Mark a `draft` contract as `sent` and attach its Odoo signature link (PRD 70
 * §3.5 — the contract is uploaded to Odoo, signature happens there). The
 * `draft → sent` transition is enforced; any other current status is rejected.
 */
export const sendContract = kbAdminMutation({
  args: { contractId: v.id("contracts"), odooLink: v.string() },
  action: "contract.send",
  handler: async (ctx, args): Promise<void> => {
    const contract = await requireContract(ctx, args.contractId);
    assertLegalContractTransition(contract.status, "sent");
    await setContractStatus(ctx, args.contractId, "sent", {
      odooLink: args.odooLink,
    });
  },
});

/**
 * Refresh a `sent` contract's signature status (PRD 70 §3.5, Q70-Q8: V1 = MANUAL
 * check; automatic Odoo webhook = V2). `signed: true` moves `sent → signed`;
 * `signed: false` is a no-op (not yet signed). The `sent → signed` transition is
 * enforced — refreshing a contract not in `sent` while claiming `signed` is
 * rejected. Returns the resulting status.
 */
export const refreshContractStatus = kbAdminMutation({
  args: { contractId: v.id("contracts"), signed: v.boolean() },
  action: "contract.refreshStatus",
  handler: async (
    ctx,
    args,
  ): Promise<{ status: Doc<"contracts">["status"] }> => {
    const contract = await requireContract(ctx, args.contractId);
    if (!args.signed) {
      // No signature confirmed yet — leave the status untouched.
      return { status: contract.status };
    }
    assertLegalContractTransition(contract.status, "signed");
    await setContractStatus(ctx, args.contractId, "signed");
    return { status: "signed" };
  },
});

/**
 * Expire a contract (PRD 70 §3.5 "expired state representable"). Legal only from
 * `draft` / `sent` (a never-completed contract lapses); a terminal `signed` /
 * `expired` is rejected by the lifecycle guard.
 */
export const expireContract = kbAdminMutation({
  args: { contractId: v.id("contracts") },
  action: "contract.expire",
  handler: async (ctx, args): Promise<void> => {
    const contract = await requireContract(ctx, args.contractId);
    assertLegalContractTransition(contract.status, "expired");
    await setContractStatus(ctx, args.contractId, "expired");
  },
});

/** Read one contract by id (root, PRD 70 §3.5 detail). */
export const getContract = kbAdminQuery({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, args): Promise<Doc<"contracts"> | null> =>
    getContractRow(ctx, args.contractId),
});

/** List a prospect's contracts (root, PRD 70 §3.5). */
export const listContractsForProspect = kbAdminQuery({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args): Promise<Doc<"contracts">[]> =>
    listContractsForProspectRows(ctx, args.prospectId),
});
