/**
 * Public API of the `cart` backend module (chantier 2.3 — Orders + Cart, PRD 10
 * Client Ordering + PRD 20 KB Orders).
 *
 * 2.3-B — `createOrderFromCart`: the single checkout transition that turns the
 * eater's SUBMITTED cart (which lives in the browser, NOT on the server) into an
 * `orders` row in state `en attente de paiement` with its lines FROZEN. It is a
 * `customerMutation` (self-scope — the order is born owned by the CALLER's own
 * `customers` fiche, resolved from `ctx.actor.userId`; there is NO `customerId`
 * argument). The cart is validated against the 2.2 menu (item exists + belongs to
 * THIS tenant + available + modifier `minSelect`/`maxSelect` + valid option labels
 * + mandatory groups present) and the resulting `orderItems` are an IMMUTABLE,
 * denormalised snapshot of name/price/modifiers+priceDelta/allergens — NOT FKs into
 * the menu (PRD 10 §7), so a later menu edit never mutates them. 1 line per item ×
 * modifiers combination (Q10-Q8c). The `pricingSnapshot` slot is filled/frozen at
 * PAYMENT by slice C (the computation is 2.4); the returned order id is consumed by
 * 2.5 to create the PaymentIntent.
 *
 * Isolation (ADR 0010): the mutation goes through the `customerMutation` wrapper and
 * reaches the menu + orders tables ONLY through the sanctioned `lib/tenancy` seams
 * (`menuStore` reads, `ordersStore.insertTenantPendingOrder`, `customerFiche`) —
 * never raw `ctx.db`. Identity flows exclusively through `getCurrentActor` (ADR
 * 0011). Ships a cross-tenant fuzz suite.
 *
 * Convex registers functions by their module PATH, so callers invoke it as
 * `api.lib.cart.cart.createOrderFromCart`; re-exporting here does not change that
 * callable path — it states the module's contract in one place. The guarded
 * mutation is therefore NOT re-exported (a barrel re-export would not change its
 * address).
 */
export {};
