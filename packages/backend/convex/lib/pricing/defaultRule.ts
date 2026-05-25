import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { insertTenantPricingRule } from "../tenancy";

/**
 * 2.4-B — the KB onboarding default pricing rule (PRD 35 §7, pricing CONTEXT
 * "Règle par défaut KB (onboarding)", Q35-Q acté 2026-05-23).
 *
 * At tenant creation, KB pre-installs exactly ONE rule:
 *  - action  = `frais_livraison_part_resto_pourcentage_panier` at **10 %**,
 *  - conditions = `[]` (applies to every delivery order),
 *  - active = true.
 *
 * The 10 % figure is the DOCUMENTED spec — not invented here. The rule is later
 * validated/adjusted with the resto at the Phase C kickoff; they may then edit,
 * deactivate or delete it.
 *
 * This is the seam the provisioning / onboarding wizard (chantier 2.9) calls. It
 * runs inside a mutation context that has ALREADY authorised the tenant (the
 * wizard provisions the tenant), so it writes through the sanctioned
 * `insertTenantPricingRule` seam scoped to the given `tenantId` — no raw `ctx.db`
 * and no public CRUD round-trip needed.
 */

/** The onboarding default: 10 % of the cart absorbed by the resto (PRD 35 §7). */
export const DEFAULT_ONBOARDING_PERCENT = 10;

/**
 * Install the onboarding default rule on `tenantId`. Returns the new rule id.
 * Created active, with no condition, per the spec.
 */
export async function installDefaultPricingRule(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Id<"pricingRules">> {
  return insertTenantPricingRule(ctx, tenantId, {
    conditions: [],
    action: {
      kind: "frais_livraison_part_resto_pourcentage_panier",
      percent: DEFAULT_ONBOARDING_PERCENT,
    },
  });
}
