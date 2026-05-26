import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { orderMode } from "../../table/orders";
import {
  type NewOrderItem,
  customerMutation,
  getOrCreateCustomerFiche,
  insertTenantPendingOrder,
  listTenantItemModifierGroups,
  requireTenantItem,
} from "../tenancy";

/**
 * 2.3-B — `createOrderFromCart`: the checkout mutation that turns a SUBMITTED
 * cart into an `orders` row in state `en attente de paiement` with its lines
 * FROZEN (PRD 10 §7/§10/§11, PRD 20, client-ordering CONTEXT, ADR 0009/0010).
 *
 * There is NO server-side cart: the [[Cart]] lives in the browser (localStorage)
 * until the eater validates it. This mutation receives that submitted cart and is
 * the single transition `cart → pending order`. It does NOT take payment (2.5),
 * compute pricing (2.4) or gate on the resto status (slice F) — it only validates
 * the cart against the menu and persists a frozen, pre-payment order.
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

    // Validate + freeze every line against THIS tenant's menu.
    const frozenItems: NewOrderItem[] = [];
    for (const line of args.items) {
      frozenItems.push(await freezeCartItem(ctx, ctx.tenantId, line));
    }

    // The order belongs to the caller's OWN fiche (self-scope, silent provisioning).
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);

    return insertTenantPendingOrder(ctx, ctx.tenantId, {
      customerId,
      mode: args.mode,
      address: args.address,
      lat: args.lat,
      lng: args.lng,
      restaurantNote: args.restaurantNote,
      items: frozenItems,
    });
  },
});
