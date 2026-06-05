import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";

/**
 * 2.3-A — `orders` + `orderItems` (FROZEN) + `orderEvents` (PRD 20 KB Orders, PRD
 * 10 PWA Client, kb-orders + client-ordering CONTEXTs, ADR 0010).
 *
 * The data foundation of chantier 2.3: the order created at checkout
 * ([[Client Ordering]]) and worked through the kitchen workflow ([[KB Orders]]).
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * All three tables carry `tenantId` and are TENANT-SCOPED: every read/write goes
 * through the tenancy wrappers (`tenantQuery` / `tenantMutation`) and reaches
 * these tables ONLY through the sanctioned `lib/tenancy/ordersStore` seam — never
 * raw `ctx.db` in the `lib/orders` business module (`no-untenanted-query`, 1.x-H).
 * The module ships a cross-tenant fuzz suite.
 *
 * ── Frozen line items (PRD 10 §7 / PRD 20 §4, Q10-Q8c) ────────────────────────
 * `orderItems` are an IMMUTABLE, DENORMALISED snapshot of the menu at order time
 * — `itemName` / `unitPrice` / `modifiers` / `allergens` are COPIED, NOT FKs into
 * the (later-chantier) menu tables. An order is therefore self-contained and
 * never changes if the menu is edited afterwards, and 2.3-A does NOT structurally
 * depend on the menu tables existing. 1 distinct line per item × modifiers
 * combination — no aggregation (Q10-Q8c).
 *
 * ── source (ADR 0009) ─────────────────────────────────────────────────────────
 * `source` exists with the single V1 value `direct`. Marketplace ingestion (Uber
 * Eats / Deliveroo via Hubrise) is V2 — there is no external ingestion path in V1
 * (ADR 0009), the enum is laid here so the V2 path is additive.
 */

/**
 * Order workflow state — the closed state machine of PRD 20 §5 + the issue body.
 * Not invented: every value is documented (PRD 20 §5 nouvelle → en préparation →
 * prête → remise → livrée/collectée; refusée per PRD 20 §6a; auto_expired per PRD
 * 20 §6b + ADR 0016; en attente de paiement is the pre-payment state, PRD 10
 * §10/§11).
 *
 * `auto_expired` (#404) — system-side terminal: a cmd still `nouvelle` 5 min
 * after `paymentSucceeded` is automatically refunded + pushed (template neutre).
 * DISTINCT from `refusée` (human refus with motif) — ADR 0016 explains why mixing
 * the two would conflate orthogonal signals (business vs operational).
 */
export const orderStatus = v.union(
  v.literal("en attente de paiement"),
  v.literal("nouvelle"),
  v.literal("en préparation"),
  v.literal("prête"),
  v.literal("remise"),
  v.literal("livrée"),
  v.literal("collectée"),
  v.literal("refusée"),
  v.literal("auto_expired"),
);

/**
 * The closed set of refusal reasons a resto picks when refusing a `nouvelle` order
 * (PRD 20 §6 + kb-orders CONTEXT "Refusal"). NOT invented — these are the four
 * documented choices: rupture (out of stock), fermeture (closed), surcharge
 * (kitchen overloaded), autre (other). Persisted as the `reason` string on the
 * `refusée` `orderEvents` row; this union guards the `refuse` mutation boundary so
 * an arbitrary reason cannot be stored.
 */
export const refusalReason = v.union(
  v.literal("rupture"),
  v.literal("fermeture"),
  v.literal("surcharge"),
  v.literal("autre"),
);

export type RefusalReason = Infer<typeof refusalReason>;

/**
 * Fulfilment mode chosen by the client at checkout (PRD 10 §3 mode toggle). The
 * `deliveries` table uses `delivery` | `click_collect`; here the order carries
 * the customer-facing `delivery` | `pickup` (= click & collect) per the issue
 * body, mapped to the delivery fulfilment row by a later 2.3/2.6 slice.
 */
export const orderMode = v.union(v.literal("delivery"), v.literal("pickup"));

/**
 * Where the order came from. V1 = `direct` ONLY (no marketplace ingestion path,
 * ADR 0009). `uber_eats` / `deliveroo` are V2 (Hubrise), laid here so the V2
 * ingestion is purely additive.
 */
export const orderSource = v.union(
  v.literal("direct"),
  v.literal("uber_eats"),
  v.literal("deliveroo"),
);

/**
 * One frozen modifier choice on a line item — a denormalised copy (groupName /
 * optionName / priceDelta), never a FK into the menu (PRD 10 §7).
 */
export const frozenModifier = v.object({
  groupName: v.string(),
  optionName: v.string(),
  priceDelta: v.number(), // cents, may be 0 or negative
});

/**
 * The pricing snapshot, FROZEN at payment (filled by chantier 2.4/2.5 — the
 * pricing engine result + the rule applied). Optional here because the row is
 * created before payment is confirmed; the amounts are in cents.
 */
export const pricingSnapshot = v.object({
  subtotal: v.number(), // sum of line items, cents
  deliveryFee: v.number(), // client share of the delivery fee, cents
  total: v.number(), // amount actually charged, cents
  appliedRuleId: v.optional(v.id("pricingRules")), // the winning rule, if any
});

export type OrderStatus = Infer<typeof orderStatus>;
export type OrderMode = Infer<typeof orderMode>;
export type OrderSource = Infer<typeof orderSource>;
export type FrozenModifier = Infer<typeof frozenModifier>;
export type PricingSnapshot = Infer<typeof pricingSnapshot>;

export const orders = defineTable({
  tenantId: v.id("tenants"),
  // FK → GLOBAL customers (the MOAT, ADR 0010). The per-tenant link / stats live
  // in customerOrdersPerTenant, written by a later 2.3 slice (#16 owns the table).
  customerId: v.id("customers"),
  status: orderStatus,
  mode: orderMode,
  source: orderSource, // V1 = "direct" (ADR 0009)
  // Delivery target — present only in `delivery` mode (PRD 10 §2 address-first).
  address: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  // Customer phone — DENORMALISED snapshot from `customers.phone` at order time
  // (pattern extended from `address`, ADR 0010 MOAT preserved). The GLOBAL
  // `customers` table is KB-owned and a `kb_manager` cannot query it directly;
  // copying the phone here lets the cuisinier reach the client for THIS order
  // (livraison ratée, allergène urgent) WITHOUT exposing the cross-tenant
  // customers base. The copy is taken once at `placeOrder` /
  // `createOrderFromCart`; a later customer phone update does NOT propagate to
  // already-placed orders (the kitchen contacts the number that was current at
  // checkout — by design, mirrors `address`). Optional because a customer may
  // have no phone yet at checkout time, and to keep V1 backfill free.
  customerPhone: v.optional(v.string()),
  // Free-text kitchen note, ≤ 200 chars, NOT forwarded to the Uber manifest
  // (client-ordering CONTEXT "Note resto").
  restaurantNote: v.optional(v.string()),
  // Frozen at payment (from chantier 2.4 pricing). Absent until paid.
  pricingSnapshot: v.optional(pricingSnapshot),
  // Loose string FKs toward the payment (2.5) / delivery (2.6) records, set when
  // those chantiers land (the `deliveries` row already keys on a string orderId).
  paymentRef: v.optional(v.string()),
  deliveryRef: v.optional(v.string()),
  createdAt: v.number(),
  paidAt: v.optional(v.number()),
  // Workflow transition timestamps — stamped as the order moves through PRD 20 §5.
  acceptedAt: v.optional(v.number()), // → en préparation
  readyAt: v.optional(v.number()), // → prête
  handedOverAt: v.optional(v.number()), // → remise
  completedAt: v.optional(v.number()), // → livrée / collectée
  refusedAt: v.optional(v.number()), // → refusée
  autoExpiredAt: v.optional(v.number()), // → auto_expired (#404, PRD 20 §6b)
})
  .index("by_tenant", ["tenantId"])
  .index("by_customer", ["customerId"])
  // Kitchen queue: a tenant's orders in a given status (PRD 20 §2 filters).
  .index("by_tenant_status", ["tenantId", "status"])
  // A customer's orders at a tenant, time-ordered.
  .index("by_customer_created", ["customerId", "createdAt"]);

/**
 * FROZEN line items — an immutable denormalised snapshot, NOT FKs into the menu
 * (PRD 10 §7). 1 row per item × modifiers combination (Q10-Q8c). Carries
 * `tenantId` (ADR 0010) so reads are tenant-scoped; keyed `by_order`.
 */
export const orderItems = defineTable({
  tenantId: v.id("tenants"),
  orderId: v.id("orders"),
  itemName: v.string(),
  unitPrice: v.number(), // cents, frozen at order time
  quantity: v.number(),
  modifiers: v.array(frozenModifier),
  // The 14 EU 1169/2011 allergens applicable to this item, frozen at order time
  // (client-ordering CONTEXT "Allergènes").
  allergens: v.array(v.string()),
}).index("by_order", ["tenantId", "orderId"]);

/**
 * Append-only order events — the time-ordered audit of every status reached (PRD
 * 20 §4 historique statuts horodaté). Carries `tenantId` (ADR 0010); keyed
 * `by_order` and `by_tenant`. `reason` is set for `refusée` (PRD 20 §6).
 *
 * `customReason` (ADR 0019) — un texte libre saisi par le restaurateur quand
 * `reason === "autre"` (catch-all). Trimé + ≤ 280 chars, propagé tel quel dans
 * le push template `refund_issued` ("Motif : ${customReason}"). Les 3 autres
 * motifs (rupture / fermeture / surcharge) ignorent silencieusement ce champ —
 * leur libellé enum porte déjà l'information côté push.
 */
export const orderEvents = defineTable({
  tenantId: v.id("tenants"),
  orderId: v.id("orders"),
  status: orderStatus, // the state reached
  actorUserId: v.optional(v.id("users")), // who triggered it (system writes leave it absent)
  reason: v.optional(v.string()), // refusal reason (PRD 20 §6)
  customReason: v.optional(v.string()), // ADR 0019 — set iff reason === "autre"
  at: v.number(),
})
  .index("by_order", ["tenantId", "orderId"])
  .index("by_tenant", ["tenantId"]);
