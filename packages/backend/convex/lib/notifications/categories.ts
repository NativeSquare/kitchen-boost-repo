import type {
  NotificationChannel,
  TransactionalCategory,
  TransactionalTrigger,
} from "../../table/notifications";

/**
 * 2.7-B — the WIRED V1 channel routing of the 8 transactional triggers into the
 * 3 categories (Archive / Temps-réel / Info statut), PRD 80 §1 matrix.
 *
 * PURE module — no Convex ctx, no I/O. It is the single source of truth the engine
 * (`./engine`) reads to decide a category + a CANDIDATE channel set per business
 * event; the engine then intersects that set with the customer's reachability
 * (read from 2.1, ADR 0012) to produce the effective sends. Hardcoded V1 — the
 * caller never overrides it (PRD 80 architecture: "routages hardcodés V1").
 *
 * The mapping is verbatim from PRD 80 §1 — NOT invented:
 *  | # | trigger                      | category    | channels (candidate)        | SMS fallback |
 *  | 1 | order_paid                   | archive     | wallet_push web_push email  | yes          |
 *  | 2 | order_received_kitchen       | info_statut | wallet_silent               | no           |
 *  | 3 | courier_pickup               | info_statut | wallet_silent web_push      | no           |
 *  | 4 | courier_dropoff              | temps_reel  | wallet_push web_push        | yes          |
 *  | 5 | order_delivered              | temps_reel  | wallet_push web_push        | no           |
 *  | 6 | refund_issued                | archive     | wallet_push web_push email  | yes          |
 *  | 7 | uber_course_failed           | archive     | wallet_push web_push email  | yes          |
 *  | 8 | pickup_ready_click_collect   | temps_reel  | wallet_push web_push        | no           |
 *
 * Trigger 3 (courier pickup) is labelled "Info statut → Temps-réel léger" in the
 * PRD: it keeps the `info_statut` category (so the closed set stays 3 categories)
 * but adds a light `web_push` on top of the silent Wallet update.
 *
 * SMS is the EXTREME fallback of the push categories (Archive + Temps-réel), only
 * on triggers 1/4/6/7 (PRD 80 §1 footnote). It is part of the cascade STRUCTURE
 * here, but NO SMS is actually sent V1 (provider open, Q80-Q4) — the engine plans
 * it as a non-sendable send.
 */

// Re-export the schema unions as this module's vocabulary (single source).
export type {
  NotificationChannel,
  TransactionalCategory,
  TransactionalTrigger,
};

/** One trigger's wired routing: its category + its candidate channels in order. */
export type TriggerRouting = {
  category: TransactionalCategory;
  /**
   * The candidate push/email channels of this trigger, in preference order. The
   * engine emits the ones the customer is reachable on (Archive = all of them, a
   * written trace; Temps-réel/Info statut = the push channels). SMS is NOT listed
   * here — it is the extreme fallback computed separately (`smsFallbackEligible`).
   */
  channels: NotificationChannel[];
  /** Whether SMS extreme fallback applies to this trigger (PRD 80 §1: 1/4/6/7). */
  smsFallback: boolean;
};

const ARCHIVE_CHANNELS: NotificationChannel[] = [
  "wallet_push",
  "web_push",
  "email",
];
const TEMPS_REEL_CHANNELS: NotificationChannel[] = ["wallet_push", "web_push"];

/**
 * The complete, hardcoded V1 routing table — exactly the 8 documented triggers
 * (PRD 80 §1). `satisfies` makes the compiler reject an invented trigger key and
 * guarantees every member of the closed `TransactionalTrigger` union is present.
 */
export const TRANSACTIONAL_ROUTING = {
  order_paid: {
    category: "archive",
    channels: ARCHIVE_CHANNELS,
    smsFallback: true,
  },
  order_received_kitchen: {
    category: "info_statut",
    channels: ["wallet_silent"],
    smsFallback: false,
  },
  courier_pickup: {
    category: "info_statut",
    channels: ["wallet_silent", "web_push"], // "Info statut → Temps-réel léger"
    smsFallback: false,
  },
  courier_dropoff: {
    category: "temps_reel",
    channels: TEMPS_REEL_CHANNELS,
    smsFallback: true,
  },
  order_delivered: {
    category: "temps_reel",
    channels: TEMPS_REEL_CHANNELS,
    smsFallback: false,
  },
  refund_issued: {
    category: "archive",
    channels: ARCHIVE_CHANNELS,
    smsFallback: true,
  },
  uber_course_failed: {
    category: "archive",
    channels: ARCHIVE_CHANNELS,
    smsFallback: true,
  },
  pickup_ready_click_collect: {
    category: "temps_reel",
    channels: TEMPS_REEL_CHANNELS,
    smsFallback: false,
  },
} satisfies Record<TransactionalTrigger, TriggerRouting>;

/** The category a trigger routes to (PRD 80 §1). */
export function categoryForTrigger(
  trigger: TransactionalTrigger,
): TransactionalCategory {
  return TRANSACTIONAL_ROUTING[trigger].category;
}

/** The candidate channel set of a trigger, in preference order (PRD 80 §1). */
export function channelsForTrigger(
  trigger: TransactionalTrigger,
): NotificationChannel[] {
  return TRANSACTIONAL_ROUTING[trigger].channels;
}

/** Whether SMS extreme fallback applies to this trigger (PRD 80 §1: 1/4/6/7). */
export function smsFallbackEligible(trigger: TransactionalTrigger): boolean {
  return TRANSACTIONAL_ROUTING[trigger].smsFallback;
}

/** Convenience groupings of the triggers by category (derived from the table). */
const triggersByCategory = (
  category: TransactionalCategory,
): TransactionalTrigger[] =>
  (Object.keys(TRANSACTIONAL_ROUTING) as TransactionalTrigger[]).filter(
    (t) => TRANSACTIONAL_ROUTING[t].category === category,
  );

export const ARCHIVE_TRIGGERS = triggersByCategory("archive");
export const TEMPS_REEL_TRIGGERS = triggersByCategory("temps_reel");
export const INFO_STATUT_TRIGGERS = triggersByCategory("info_statut");

/** The triggers SMS extreme fallback applies to (PRD 80 §1: 1/4/6/7). */
export const SMS_FALLBACK_TRIGGERS = (
  Object.keys(TRANSACTIONAL_ROUTING) as TransactionalTrigger[]
).filter((t) => TRANSACTIONAL_ROUTING[t].smsFallback);
