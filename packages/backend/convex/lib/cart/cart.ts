import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { orderMode } from "../../table/orders";
import { tenantAcceptsOrderNow } from "../orders/status";
import {
  type NewOrderItem,
  customerMutation,
  getOrCreateCustomerFiche,
  insertTenantPendingOrder,
  listTenantItemModifierGroups,
  readCustomerFicheById,
  requireTenantItem,
} from "../tenancy";

/**
 * 2.3-B — `createOrderFromCart`: the checkout mutation that turns a SUBMITTED
 * cart into an `orders` row in state `en attente de paiement` with its lines
 * FROZEN (PRD 10 §7/§10/§11, PRD 20, client-ordering CONTEXT, ADR 0009/0010).
 *
 * There is NO server-side cart: the [[Cart]] lives in the browser (localStorage)
 * until the eater validates it. This mutation receives that submitted cart and is
 * the single transition `cart → pending order`. It does NOT take payment (2.5) or
 * compute pricing (2.4) — it validates the cart against the menu, GATES on the
 * resto's operational status (slice F: closed OR paused ⇒ refused, no pre-order V1
 * per PRD 10 edge), and persists a frozen, pre-payment order.
 *
 * ── Self-scope (the customer creating the order is the caller) ────────────────
 * Built on `customerMutation`: the handler ctx exposes ONLY the caller's own
 * `actor.userId` (ADR 0011) — there is deliberately NO `customerId` argument. The
 * order is born owned by the caller's OWN `customers` fiche, resolved (and silently
 * provisioned, ADR 0008) via the sanctioned `getOrCreateCustomerFiche` seam. So an
 * eater can never place an order on behalf of another customer.
 *
 * ── Validation against the 2.2 menu (item exists / available / modifiers) ─────
 * Every cart line is checked against the tenant's menu, read ONLY through the
 * sanctioned `lib/tenancy/menuStore` seam (never raw `ctx.db`, `no-untenanted-query`):
 *  - the item must exist AND belong to THIS tenant (`requireTenantItem` throws for a
 *    missing OR foreign-tenant id — this rejects a cross-tenant item reference);
 *  - the item must be `available` (else `Item out of stock`, PRD §5 / edge case);
 *  - each modifier group selected must be ATTACHED to the item, the chosen option
 *    labels must belong to that group, and the count must satisfy the group's
 *    `minSelect` / `maxSelect` (PRD §6, Uber Manager model);
 *  - every MANDATORY group attached to the item (`minSelect > 0`) must be present.
 *
 * ── Frozen lines (PRD 10 §7, Q10-Q8c) ─────────────────────────────────────────
 * The resulting `orderItems` are an IMMUTABLE, denormalised snapshot taken from the
 * menu at checkout time — `itemName` / `unitPrice` / `modifiers` (with `priceDelta`)
 * / `allergens` are COPIED, never FKs. A later menu edit never mutates them. ONE
 * line per item × modifiers combination — no aggregation.
 *
 * ── pricingSnapshot ───────────────────────────────────────────────────────────
 * Deliberately NOT set here: the slot exists on the `orders` row (table 2.3-A) and
 * is filled/frozen at PAYMENT by slice C (the computation itself is 2.4). Returns
 * the new order id (consumed by 2.5 to create the PaymentIntent).
 */

/** A free-text kitchen note is capped at 200 chars (client-ordering CONTEXT). */
const MAX_NOTE_LENGTH = 200;

const invalidCart = (message: string) =>
  new ConvexError({ code: "INVALID_CART", message });

/** One option chosen inside a modifier group, by its label. */
const cartModifierSelection = v.object({
  modifierGroupId: v.id("modifierGroups"),
  optionLabels: v.array(v.string()),
});

/** One submitted cart line: an item, a quantity, and its modifier selections. */
const cartItem = v.object({
  itemId: v.id("menuItems"),
  quantity: v.number(),
  modifierSelections: v.array(cartModifierSelection),
});

/**
 * Validate one submitted modifier group selection against the item's ATTACHED
 * groups and return the frozen modifier choices for it. Throws `INVALID_CART` for
 * a group not attached to the item, an unknown option label, a duplicate option,
 * or a selection count outside the group's `minSelect` / `maxSelect`.
 */
function freezeGroupSelection(
  group: Doc<"modifierGroups">,
  optionLabels: string[],
): NewOrderItem["modifiers"] {
  if (optionLabels.length < group.minSelect) {
    throw invalidCart(
      `Modifier group "${group.name}" requires at least ${group.minSelect} choice(s).`,
    );
  }
  if (optionLabels.length > group.maxSelect) {
    throw invalidCart(
      `Modifier group "${group.name}" allows at most ${group.maxSelect} choice(s).`,
    );
  }
  const seen = new Set<string>();
  const frozen: NewOrderItem["modifiers"] = [];
  for (const label of optionLabels) {
    if (seen.has(label)) {
      throw invalidCart(
        `Modifier group "${group.name}" selected option "${label}" twice.`,
      );
    }
    seen.add(label);
    const option = group.options.find((o) => o.label === label);
    if (option === undefined) {
      throw invalidCart(
        `Option "${label}" does not belong to modifier group "${group.name}".`,
      );
    }
    frozen.push({
      groupName: group.name,
      optionName: option.label,
      priceDelta: option.priceDelta,
    });
  }
  return frozen;
}

/**
 * Validate one submitted cart line against the menu and FREEZE it into an
 * `orderItems` snapshot. The item must exist + belong to `tenantId` (else the store
 * throws NOT_FOUND — rejecting a cross-tenant reference), be available, and have
 * every selected group attached to it + every MANDATORY attached group satisfied.
 */
async function freezeCartItem(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  line: {
    itemId: Id<"menuItems">;
    quantity: number;
    modifierSelections: {
      modifierGroupId: Id<"modifierGroups">;
      optionLabels: string[];
    }[];
  },
): Promise<NewOrderItem> {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw invalidCart("Each cart line must have a positive integer quantity.");
  }

  // Item exists AND belongs to this tenant (throws NOT_FOUND otherwise — this is
  // what rejects an item smuggled from another tenant).
  const item = await requireTenantItem(ctx, tenantId, line.itemId);
  if (!item.available) {
    throw invalidCart(`Item "${item.name}" is out of stock.`);
  }

  // The groups actually ATTACHED to this item (resolved through the N-N link).
  const attachedGroups = await listTenantItemModifierGroups(
    ctx,
    tenantId,
    line.itemId,
  );
  const groupById = new Map(attachedGroups.map((g) => [g._id, g]));

  // A group may be selected at most once per line.
  const selectedGroupIds = new Set<string>();
  const frozenModifiers: NewOrderItem["modifiers"] = [];
  for (const selection of line.modifierSelections) {
    if (selectedGroupIds.has(selection.modifierGroupId)) {
      throw invalidCart("A modifier group was selected twice on one line.");
    }
    selectedGroupIds.add(selection.modifierGroupId);
    const group = groupById.get(selection.modifierGroupId);
    if (group === undefined) {
      throw invalidCart(
        `Modifier group is not attached to item "${item.name}".`,
      );
    }
    frozenModifiers.push(
      ...freezeGroupSelection(group, selection.optionLabels),
    );
  }

  // Every MANDATORY attached group (minSelect > 0) must have been chosen.
  for (const group of attachedGroups) {
    if (group.minSelect > 0 && !selectedGroupIds.has(group._id)) {
      throw invalidCart(
        `Mandatory modifier group "${group.name}" must be chosen.`,
      );
    }
  }

  return {
    itemName: item.name,
    unitPrice: item.basePrice, // CENTIMES, frozen at checkout
    quantity: line.quantity,
    modifiers: frozenModifiers,
    allergens: [...item.allergens],
  };
}

/**
 * Turn the eater's SUBMITTED cart into an order in `en attente de paiement` with
 * FROZEN lines. Self-scoped (the order belongs to the caller's own fiche). Returns
 * the new order id (consumed by 2.5 to create the PaymentIntent).
 */
export const createOrderFromCart = customerMutation({
  args: {
    mode: orderMode,
    address: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    restaurantNote: v.optional(v.string()),
    // The FRESH Uber quote id latched at click-Payer (`recaptureQuoteAtPayment`),
    // passed for a DELIVERY order so it is persisted on the order and read back by
    // the Stripe webhook (`confirmPaymentSucceeded`) to seed the delivery WITH a
    // quote — without it the 2.6-C course executor spuriously aborts
    // `refused_post_payment`. Absent for `pickup` (no course gate).
    quoteId: v.optional(v.string()),
    items: v.array(cartItem),
  },
  handler: async (ctx, args): Promise<Id<"orders">> => {
    if (args.items.length === 0) {
      throw invalidCart("The cart is empty.");
    }
    if (
      args.restaurantNote !== undefined &&
      args.restaurantNote.length > MAX_NOTE_LENGTH
    ) {
      throw invalidCart(
        `The restaurant note must be at most ${MAX_NOTE_LENGTH} characters.`,
      );
    }

    // Slice F gate: the resto must accept an order RIGHT NOW (within service hours
    // AND not paused) — no pre-order V1 (PRD 10 edge "resto fermé / pause"). Checked
    // before any menu read so a closed/paused resto refuses fast, and through the
    // shared `tenantAcceptsOrderNow` so the gate is defined once (same rule the
    // public `acceptsOrderNow` read serves to the PWA).
    if (!(await tenantAcceptsOrderNow(ctx, ctx.tenantId))) {
      throw new ConvexError({
        code: "RESTO_NOT_ACCEPTING",
        message:
          "Le resto n'accepte pas de commande pour le moment (fermé ou en pause).",
      });
    }

    // Validate + freeze every line against THIS tenant's menu.
    const frozenItems: NewOrderItem[] = [];
    for (const line of args.items) {
      frozenItems.push(await freezeCartItem(ctx, ctx.tenantId, line));
    }

    // The order belongs to the caller's OWN fiche (self-scope, silent provisioning).
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);

    // Denormalise `customers.phone` onto the pending order (pattern extended
    // from `address`, ADR 0010 MOAT preserved). The fiche is the caller's OWN
    // (just resolved above from `ctx.actor.userId`), so this read crosses no
    // privacy boundary; the snapshot is bounded to THIS order so a future
    // `kb_manager` reading `getOrder` only ever sees the phone of customers
    // who ordered at THEIR tenant (no cross-tenant customers listing).
    const fiche = await readCustomerFicheById(ctx, customerId);

    return insertTenantPendingOrder(ctx, ctx.tenantId, {
      customerId,
      mode: args.mode,
      address: args.address,
      lat: args.lat,
      lng: args.lng,
      customerPhone: fiche?.phone,
      restaurantNote: args.restaurantNote,
      // Only DELIVERY binds a course to a quote; the seam also drops it for a pickup,
      // but gating here keeps the intent explicit at the checkout boundary.
      quoteId: args.mode === "delivery" ? args.quoteId : undefined,
      items: frozenItems,
    });
  },
});
