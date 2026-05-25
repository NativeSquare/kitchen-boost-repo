import {
  type PricingInput,
  type PricingResult,
  type Rule,
  engine,
} from "@packages/shared/pricing";
import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { listTenantPricingRules, tenantQuery } from "../tenancy";

/**
 * 2.4-C — the backend `evaluate` query (PRD 35 §3, ADR 0013, ADR 0010).
 *
 * This is the ONLY way the front gets a delivery price. The front sends its
 * cart + context (items, subtotal, datetime, customer counters, gross Uber
 * Direct cost); the backend loads the calling tenant's ACTIVE pricing rules
 * (#32) through the SANCTIONED tenancy seam, feeds the pure engine
 * (`@packages/shared/pricing`, #29) and returns ONLY the computed price (the
 * winning rule id + the client/resto split). The front NEVER receives the rules
 * or the formula — the pure module is never imported by `apps/web` (ADR 0013).
 *
 * Indicative (cart) vs. definitive ("Payer" / latching) is the SAME query the
 * front re-calls: same input → same price (deterministic), so a re-evaluation at
 * payment latches the price the customer was shown unless the cart/context/rules
 * changed. `evaluate` WRITES NOTHING — it never touches the order; the pricing
 * trace is frozen on the order at payment (chantier 2.3).
 *
 * TENANT-SCOPED via `tenantQuery` (`allow: ["kb_manager"]`; a `kb_admin` passes
 * via the root override): the rules are read ONLY through `listTenantPricingRules`
 * scoped to `ctx.tenantId`, never raw `ctx.db.query("pricingRules")`
 * (`no-untenanted-query`, ADR 0010). The cross-tenant fuzz asserts an
 * unauthorized `tenantId` throws Forbidden.
 *
 * RUNTIME WIRING NOTE (issue #39 "Blocked by"): the customer counters
 * (`premiere_cmd_client` / `nombre_cmds_client`, from `customerOrdersPerTenant`,
 * #16) and the cart items used by `contient_item` (the menu, #17) are NOT yet
 * read from their tables at runtime — those chantiers are still open. Until then
 * they are supplied as CALL ARGUMENTS (the front already holds the cart; the
 * counters arrive as a fixture/parameter). Wiring them to the live tables is a
 * follow-up once #16/#17 land — the engine input shape does not change.
 */

/** A single cart line item, as sent by the front. */
const cartItem = v.object({
  itemId: v.string(),
  category: v.string(),
  quantity: v.number(),
});

/** The customer counters the conditions read (from #16 at runtime; fixture for now). */
const customerProfile = v.object({
  isFirstOrder: v.boolean(),
  orderCount: v.number(),
});

/** The output the front receives: ONLY the computed price (ADR 0013). */
const pricingResultValidator = v.object({
  winningRuleId: v.union(v.string(), v.null()),
  fraisLivraisonClientCents: v.number(),
  fraisLivraisonRestoCents: v.number(),
});

/** Map a persisted ACTIVE rule row onto the pure engine's `Rule` shape. */
function toEngineRule(row: Doc<"pricingRules">): Rule {
  return {
    id: row._id,
    conditions: row.conditions,
    action: row.action,
  };
}

export const evaluate = tenantQuery()({
  args: {
    items: v.array(cartItem),
    totalPanierCents: v.number(),
    /** Order date/time as epoch ms (Convex args carry no `Date`). */
    orderDateTimeMs: v.number(),
    customer: customerProfile,
    /** Gross Uber Direct quote in cents (from #40 at runtime; argument for now). */
    grossDeliveryCostCents: v.number(),
  },
  returns: pricingResultValidator,
  handler: async (ctx, args): Promise<PricingResult> => {
    // Load ONLY the calling tenant's rules through the sanctioned seam, then keep
    // the ACTIVE ones — inactive rules are configured-but-paused, never evaluated.
    const rules = (await listTenantPricingRules(ctx, ctx.tenantId))
      .filter((row) => row.active)
      .map(toEngineRule);

    const input: PricingInput = {
      items: args.items,
      totalPanierCents: args.totalPanierCents,
      orderDateTime: new Date(args.orderDateTimeMs),
      customer: args.customer,
      grossDeliveryCostCents: args.grossDeliveryCostCents,
      rules,
    };

    // The pure engine picks the deterministic winner (the rule minimising the
    // client fee, Q35-Q2) and guarantees `client + resto = gross`. We return its
    // result verbatim — never the rules or the formula (ADR 0013).
    return engine.evaluate(input);
  },
});
