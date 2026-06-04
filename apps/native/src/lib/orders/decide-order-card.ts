/**
 * #401 — pure decision functions for the KB Orders home card + detail workflow
 * (PRD 20 §2 / §4 / §5 + kb-orders CONTEXT). Same split convention as
 * `decideForceUpdate` (#394), `decidePushPermissionBanner` (#395),
 * `decideOnboardingStep` (#398), `decideTenantSwitcher` (#399) — keeping React,
 * Convex and Expo out of the matrix means the truth table is pinned by a fast
 * deterministic vitest suite (Node env, no jsdom, no native mocks).
 *
 * The React components `<OrderCard />` (home list) and the detail screen are
 * thin adapters that resolve `tenantOrders` / `getOrder` via Convex and
 * delegate every branching decision (mode tag, status label, badge nouvelle,
 * which workflow button) to the functions in this module.
 *
 * Three functions, one module:
 *
 *  - `decideModeTag` — pure projection of the order mode to the visible tag
 *    (PRD 20 §2 / §11). 🚴 LIVRAISON for `delivery`, 🛍️ À EMPORTER for `pickup`.
 *    Defends against forward-compat enum values returning `null`.
 *
 *  - `decideStatusLabel` — pure projection of the workflow status to a French
 *    human label (PRD 20 §5). Used by both the home card and the detail header.
 *
 *  - `decideWorkflowButton` — given (status, mode), decides which workflow
 *    action button to surface on the detail screen, OR `none` for terminal /
 *    invisible states. This encodes the state machine of PRD 20 §5 on the
 *    READ side (the backend `assertLegalTransition` already enforces it on
 *    the write side — this is defense in depth + UX: we never offer the
 *    cuisinier a button that would throw).
 *
 *      `nouvelle`        → "acknowledge"   (label: "Accepter / Préparer")
 *      `en préparation`  → "markPrepared"  (label: "Prête")
 *      `prête` + delivery → "markHandedOff" (label: "Remise au coursier")
 *      `prête` + pickup  → "markHandedOff" (label: "Remise au client")
 *      everything else   → `none`
 *
 *    The Refuse button (#403) and the auto-expired terminal (#404) are out of
 *    scope here — this story is the happy path only (Accept → Prête → Remise
 *    coursier in delivery mode). The button decision is intentionally narrow
 *    so the V1 happy path stays unambiguous in the UI.
 *
 *  - `decideOrderBadgeNew` — whether to show the "nouvelle" badge on the home
 *    card (PRD 20 §2 « Badge "nouvelle" non lue »). The card carries a badge
 *    iff the order is in status `nouvelle` — the simplest read-side rule that
 *    matches the spec (the cuisinier "reads" the order by acknowledging it,
 *    which transitions the status away from `nouvelle`).
 */

import type {
  OrderMode,
  OrderStatus,
} from "@packages/backend/convex/lib/orders";

/** PRD 20 §2 / §11 — the mode tag visible on every card. */
export type ModeTag = {
  emoji: string;
  label: string;
};

export function decideModeTag(mode: OrderMode): ModeTag | null {
  switch (mode) {
    case "delivery":
      // 🚴 LIVRAISON — PRD 20 §2 (« tag mode 🚴 LIVRAISON »).
      return { emoji: "🚴", label: "LIVRAISON" };
    case "pickup":
      // 🛍️ À EMPORTER — PRD 20 §11 (« tag visible 🛍️ À EMPORTER »).
      return { emoji: "🛍️", label: "À EMPORTER" };
    default:
      // Forward-compat: a future enum value (marketplace V2, etc.) should not
      // crash the card — fall back to no tag rather than throw.
      return null;
  }
}

/** PRD 20 §5 — French human-readable status label.
 *
 * `en attente de paiement` is mapped to a discreet label but should never be
 * surfaced on the home card (the backend `tenantOrders` query already filters
 * those out — PRD 20 §2 « NEVER includes `en attente de paiement` »). It is
 * still mapped here for the detail screen, which can be reached by id even on
 * a pre-payment row (defense in depth).
 */
export function decideStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "en attente de paiement":
      return "En attente de paiement";
    case "nouvelle":
      return "Nouvelle";
    case "en préparation":
      return "En préparation";
    case "prête":
      return "Prête";
    case "remise":
      return "Remise";
    case "livrée":
      return "Livrée";
    case "collectée":
      return "Collectée";
    case "refusée":
      return "Refusée";
    default:
      return "—";
  }
}

/** PRD 20 §5 happy-path workflow buttons surfaced on the detail screen. */
export type WorkflowAction = "acknowledge" | "markPrepared" | "markHandedOff";

export type WorkflowButtonDecision =
  | { kind: "none" }
  | {
      kind: "show";
      action: WorkflowAction;
      label: string;
    };

/**
 * Decide which workflow action button to show on the detail screen for an
 * order at (status, mode). Encodes the happy path of PRD 20 §5 on the READ
 * side — terminal states + `en attente de paiement` + `refusée` show no
 * button.
 *
 * Refuse (#403, #413) is decided independently by `decideRefuseButton` +
 * `decideRefuseStepCount` (in `decide-refuse-flow.ts`); auto_expired (#404)
 * lands on the read side via `decideStatusLabel`.
 */
export function decideWorkflowButton(
  status: OrderStatus,
  mode: OrderMode,
): WorkflowButtonDecision {
  switch (status) {
    case "nouvelle":
      // PRD 20 §5 — « bouton "Accepter / Préparer" ».
      return {
        kind: "show",
        action: "acknowledge",
        label: "Accepter / Préparer",
      };
    case "en préparation":
      // PRD 20 §5 — « bouton "Prête" ».
      return { kind: "show", action: "markPrepared", label: "Prête" };
    case "prête":
      // PRD 20 §5 — mode-specific handoff label. `delivery` → coursier,
      // `pickup` → client. Forward-compat: an unknown mode (marketplace V2)
      // gets a neutral label rather than a crash.
      if (mode === "delivery") {
        return {
          kind: "show",
          action: "markHandedOff",
          label: "Remise au coursier",
        };
      }
      if (mode === "pickup") {
        return {
          kind: "show",
          action: "markHandedOff",
          label: "Remise au client",
        };
      }
      return {
        kind: "show",
        action: "markHandedOff",
        label: "Remise",
      };
    case "en attente de paiement":
    case "remise":
    case "livrée":
    case "collectée":
    case "refusée":
      // Terminal / pre-payment states — no button surfaced (PRD 20 §5 fade
      // out at terminal, and pre-payment is never shown to the resto).
      return { kind: "none" };
    default:
      return { kind: "none" };
  }
}

/**
 * PRD 20 §2 — "Badge nouvelle" non lue on the home card. The simplest read-
 * side rule that matches the spec: a `nouvelle` order is unread; everything
 * else has been acted on (acknowledged → en préparation, or terminal).
 *
 * Tracking actual "seen by this device" would require a per-device read
 * cursor backend-side (out of V1 scope — PRD 20 §2 doesn't ask for it). The
 * cuisinier reads the order by acknowledging it.
 */
export function decideOrderBadgeNew(status: OrderStatus): boolean {
  return status === "nouvelle";
}

/**
 * #402 — PRD 20 §4 « note "à emporter" (si click & collect) ». The detail
 * screen mirrors the delivery's « Adresse livraison » card with a discreet
 * « À emporter » placeholder so the cuisinier sees AT A GLANCE what to do
 * with the prepped bag. Decided by mode alone — the click & collect signal
 * is already carried by the mode tag (🛍️ À EMPORTER on every card) and by
 * the workflow button (« Remise au client »); this card is the third visible
 * touchpoint of the same signal on the detail screen (mode tag in header,
 * handoff note as a body card, button at the bottom).
 *
 * NO customer name surfaced (the MOAT, ADR 0010 §"Customer rules" — `kb_manager`
 * cannot read raw customer fields) and NO pickup time (the `orders` row carries
 * none today; PRD 20 §4 does not ask for it). The body intentionally states
 * the bare invariant of the click & collect mode: « Le client passera récupérer
 * la commande. » — no invented copy, no MOAT-breaking detail.
 */
export type PickupHandoffNoteDecision =
  | { kind: "hide" }
  | { kind: "show"; heading: string; body: string };

export function decidePickupHandoffNote(
  mode: OrderMode,
): PickupHandoffNoteDecision {
  if (mode === "pickup") {
    return {
      kind: "show",
      heading: "À emporter",
      body: "Le client passera récupérer la commande.",
    };
  }
  return { kind: "hide" };
}
