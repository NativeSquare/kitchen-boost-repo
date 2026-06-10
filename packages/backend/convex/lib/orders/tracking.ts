import { v } from "convex/values";
import { deliveryIncidentType, deliveryStatus } from "../../table/deliveries";
import { frozenModifier, orderMode, orderStatus } from "../../table/orders";
import {
  getTenantDeliveryByOrder,
  getTenantOrderWithDetail,
  publicTenantQuery,
} from "../tenancy";

/**
 * PWA-S8 (#459) — `getOrderTracking` : the PUBLIC tracking projection
 * consumed by the customer-facing `/c/[orderId]` page (PRD 10 §11 « Page
 * Tracking », US 50 → 55, decisions-log Q7).
 *
 * ── Why PUBLIC (no auth gate) ─────────────────────────────────────────────
 * The tracking URL is INTENTIONALLY UN-AUTH-GATED (PRD 10 §11 + acceptance
 * criterion #459 « URL /c/[orderId] partagée à autre device sans cookie →
 * tracking visible ») : a customer can share it (SMS / push deep-link) so a
 * fresh device with no Convex Auth cookie still resolves the page. The
 * un-guessable Convex id of the order IS the access token — the same model
 * as a Stripe receipt URL (`/payments/<unguessable_pi>`).
 *
 * ── Isolation discipline (ADR 0010) ───────────────────────────────────────
 * The query takes `tenantId` (resolved by the PWA edge middleware from the
 * host → `__Host-kb_tenant` cookie, ADR 0008) AND `orderId`, and reaches
 * the tables ONLY through the sanctioned `lib/tenancy` seams
 * (`getTenantOrderWithDetail`, `getTenantDeliveryByOrder`) — no raw
 * `ctx.db` here (`no-untenanted-query`). A foreign `(tenantId, orderId)`
 * returns `null` indistinguishably from a missing order (no cross-tenant
 * existence oracle). A foreign / dangling tenantId throws Forbidden via
 * `publicTenantQuery`'s built-in resolution (same shape as `getPublicMenu`).
 *
 * ── MOAT (ADR 0010) ──────────────────────────────────────────────────────
 * The projection is MINIMAL on purpose : the tracking UI only needs the
 * status / mode / items / address / total / delivery ETA + incident type.
 * NO `customerId`, NO `customerPhone`, NO `restaurantNote` (kitchen-side
 * only — the « note pour le resto » freeform field, PRD 10 §7) — the URL
 * is shareable and the surface must NOT leak the per-order link to the
 * customer fiche (ADR 0010 MOAT). Identity discovery from a shared
 * tracking URL would be a cross-customer leak even within the same tenant.
 *
 * ── Convex sub realtime (decisions-log Q7) ───────────────────────────────
 * The client subscribes via `useQuery` — every write through the workflow
 * (`recordStatus`, `confirmPayment`, the Uber webhook applier) re-runs the
 * Convex push and re-renders the page < 500ms (acceptance criterion #459
 * « Webhook Uber Direct simulé → UI re-render <500ms »). No polling, no
 * `setInterval` for the order/delivery state itself.
 */

/** The shape returned to the customer-facing page. Stable contract. */
export type OrderTrackingProjection = {
  status:
    | "en attente de paiement"
    | "nouvelle"
    | "en préparation"
    | "prête"
    | "remise"
    | "livrée"
    | "collectée"
    | "refusée"
    | "auto_expired";
  mode: "delivery" | "pickup";
  address: string | null;
  createdAt: number;
  /** Total in cents, NULL until the payment-confirming write seals it. */
  totalCentimes: number | null;
  items: Array<{
    itemName: string;
    quantity: number;
    unitPrice: number;
    modifiers: Array<{
      groupName: string;
      optionName: string;
      priceDelta: number;
    }>;
    allergens: string[];
  }>;
  /** `null` for C&C (no Uber course) or pre-course (course not yet seeded). */
  delivery: {
    status:
      | "pending"
      | "pickup"
      | "pickup_complete"
      | "dropoff"
      | "delivered"
      | "canceled"
      | "returned"
      | "failed";
    mode: "delivery" | "click_collect";
    pickupEta: number | undefined;
    dropoffEta: number | undefined;
    incidentType:
      | "refused_post_payment"
      | "incident_after_pickup"
      | "customer_absent"
      | undefined;
  } | null;
};

/** The Convex validator for the projection above — keeps the wire stable. */
const orderTrackingProjection = v.object({
  status: orderStatus,
  mode: orderMode,
  address: v.union(v.string(), v.null()),
  createdAt: v.number(),
  totalCentimes: v.union(v.number(), v.null()),
  items: v.array(
    v.object({
      itemName: v.string(),
      quantity: v.number(),
      unitPrice: v.number(),
      modifiers: v.array(frozenModifier),
      allergens: v.array(v.string()),
    }),
  ),
  delivery: v.union(
    v.null(),
    v.object({
      status: deliveryStatus,
      mode: v.union(v.literal("delivery"), v.literal("click_collect")),
      pickupEta: v.optional(v.number()),
      dropoffEta: v.optional(v.number()),
      incidentType: v.optional(deliveryIncidentType),
    }),
  ),
});

/**
 * Read one tenant's order tracking projection (PUBLIC, unauthenticated). Returns
 * `null` if the order does not exist OR does not belong to `tenantId` — no
 * cross-tenant existence oracle (ADR 0010). Throws Forbidden if `tenantId`
 * itself does not resolve (publicTenantQuery's built-in guard).
 */
export const getOrderTracking = publicTenantQuery({
  args: { orderId: v.id("orders") },
  returns: v.union(orderTrackingProjection, v.null()),
  handler: async (ctx, args): Promise<OrderTrackingProjection | null> => {
    const order = await getTenantOrderWithDetail(
      ctx,
      ctx.tenantId,
      args.orderId,
    );
    if (order === null) return null;

    // `deliveries.orderId` is stored as a plain string (it doubles as Uber's
    // `manifest_reference`, see `table/deliveries.ts` header). A Convex `Id` IS
    // a branded string at runtime, so the implicit widening is safe.
    const delivery = await getTenantDeliveryByOrder(
      ctx,
      ctx.tenantId,
      args.orderId,
    );

    return {
      status: order.status,
      mode: order.mode,
      address: order.address ?? null,
      createdAt: order.createdAt,
      totalCentimes: order.pricingSnapshot?.total ?? null,
      // Project only the SHAREABLE-SAFE item fields — no tenantId, no order
      // FK, no Convex ids (defensive against future schema additions).
      items: order.items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        modifiers: item.modifiers.map((m) => ({
          groupName: m.groupName,
          optionName: m.optionName,
          priceDelta: m.priceDelta,
        })),
        allergens: [...item.allergens],
      })),
      delivery:
        delivery === null
          ? null
          : {
              status: delivery.status,
              mode: delivery.mode,
              pickupEta: delivery.pickupEta,
              dropoffEta: delivery.dropoffEta,
              incidentType: delivery.incidentType,
            },
    };
  },
});
