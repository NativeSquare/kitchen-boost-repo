import { ConvexError, type Infer } from "convex/values";
import type { contractStatus } from "../../table/contracts";

/**
 * 2.9-D — the PURE contract lifecycle state machine (PRD 70 §3.5, kb-admin
 * CONTEXT "Statut contrat": `draft → sent → signed`, plus `→ expired`).
 *
 * The lifecycle is the SINGLE source of truth for which status transitions are
 * legal; the `contracts` mutations defer to `assertLegalContractTransition` so an
 * illegal move (e.g. `signed → draft`, or leaving a terminal state) can never be
 * persisted. NO status outside the schema's `contractStatus` union is introduced.
 *
 * Edges (none invented — straight from the PRD/CONTEXT lifecycle):
 *  - `draft  → sent`     : the contract is uploaded to Odoo for signature.
 *  - `sent   → signed`   : signature confirmed (V1 = manual check; Odoo webhook
 *                          = V2, Q70-Q8).
 *  - `draft  → expired`  : a never-sent draft lapses.
 *  - `sent   → expired`  : a sent-but-unsigned contract lapses.
 *  - `signed` / `expired`: TERMINAL — no outgoing edge.
 */

export type ContractStatus = Infer<typeof contractStatus>;

/**
 * The allowed outgoing transitions per status. `signed` and `expired` are
 * terminal (empty arrays). Mirrors the `ordersStore` transition-map pattern.
 */
export const CONTRACT_STATUS_TRANSITIONS: Record<
  ContractStatus,
  ContractStatus[]
> = {
  draft: ["sent", "expired"],
  sent: ["signed", "expired"],
  signed: [],
  expired: [],
};

/** Whether `from → to` is a legal contract lifecycle transition. Pure — no DB. */
export function isLegalContractTransition(
  from: ContractStatus,
  to: ContractStatus,
): boolean {
  return CONTRACT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Throw `INVALID_STATE` unless `from → to` is a legal transition. Centralises the
 * lifecycle guard so a skip-ahead (`draft → signed`), a backward step
 * (`signed → draft`), a terminal exit (`signed → expired`), or a self-loop is
 * rejected, never silently applied (mirrors `ordersStore.assertLegalTransition`).
 */
export function assertLegalContractTransition(
  from: ContractStatus,
  to: ContractStatus,
): void {
  if (!isLegalContractTransition(from, to)) {
    throw new ConvexError({
      code: "INVALID_STATE",
      message: `Illegal contract transition "${from}" → "${to}".`,
    });
  }
}
