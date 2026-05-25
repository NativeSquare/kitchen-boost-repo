import { type ReachabilityInput, channelReachability } from "../customer";
import {
  type NotificationChannel,
  type TransactionalCategory,
  type TransactionalTrigger,
  categoryForTrigger,
  channelsForTrigger,
  smsFallbackEligible,
} from "./categories";

/**
 * 2.7-B — the PURE Notifications engine: a business event in, the LIST of
 * effective sends out. No Convex ctx, no network I/O (the concrete transports —
 * web-push route #54, APNs #71, email — are later slices); it decides WHAT to send
 * and on WHICH channel, so it is unit-testable in isolation like
 * `packages/shared/pricing`.
 *
 * ── Reachability is READ from 2.1, never duplicated (ADR 0012) ────────────────
 * `channelAvailabilityFrom` takes the SAME `ReachabilityInput` 2.1 Customer Data
 * exposes (`lib/customer`) and builds on 2.1's pure `channelReachability` rule for
 * email/SMS — Notifications owns "we send the message", Customer Data owns "who is
 * reachable and by which id". The engine only needs ONE extra distinction 2.1's
 * coarse `push` boolean does not carry: Wallet vs Web Push individually (Archive
 * routes to both, the silent Wallet update needs a Wallet pass). That per-channel
 * read is done HERE from the same `pushEnrollment` object — no id is copied or
 * stored in 2.7.
 */

/** Re-export the routing vocabulary so callers import it from the engine surface. */
export type {
  NotificationChannel,
  TransactionalCategory,
  TransactionalTrigger,
};

/**
 * Per-channel availability of one customer, derived from the 2.1 reachability
 * fields. Finer-grained than 2.1's `{ push, email, sms }` because the routing
 * matrix distinguishes Wallet push, the silent Wallet update and Web Push.
 */
export type ChannelAvailability = {
  /** Wallet pass enrolled ⇒ a Wallet lock-screen push can be delivered. */
  walletPush: boolean;
  /** Web-push subscription enrolled ⇒ a PWA Web Push can be delivered. */
  webPush: boolean;
  /** A Wallet pass exists ⇒ the silent card update is possible (same enrolment). */
  walletSilent: boolean;
  /** An email address is on file. */
  email: boolean;
  /** A phone number is on file (the SMS extreme-fallback prerequisite). */
  sms: boolean;
};

/**
 * Build the per-channel availability from a customer's 2.1 reachability fields.
 * Email/SMS reuse 2.1's pure rule verbatim; the Wallet/Web-Push split reads the
 * per-channel `*Status === "enrolled"` off the same `pushEnrollment` object (a
 * `revoked` / `not_enrolled` / absent channel is unavailable). The silent Wallet
 * update rides the same Wallet enrolment as the Wallet push.
 */
export function channelAvailabilityFrom(
  input: ReachabilityInput,
): ChannelAvailability {
  const reach = channelReachability(input);
  const walletEnrolled = input.pushEnrollment?.walletStatus === "enrolled";
  const webPushEnrolled = input.pushEnrollment?.webPushStatus === "enrolled";
  return {
    walletPush: walletEnrolled,
    webPush: webPushEnrolled,
    walletSilent: walletEnrolled,
    email: reach.email,
    sms: reach.sms,
  };
}

/** One planned send: the effective channel + the category that routed it. */
export type PlannedSend = {
  channel: NotificationChannel;
  category: TransactionalCategory;
  /**
   * `false` for the SMS extreme fallback only: it is part of the cascade STRUCTURE
   * (PRD 80 §1) but no SMS provider is wired V1 (Q80-Q4 open) — so it is journaled
   * (queued) but never actually dispatched. Every other channel is `sendable`; the
   * concrete transport plugs in later (web-push #54, APNs #71, email).
   */
  sendable: boolean;
};

/** Whether a customer is reachable on a given candidate channel. */
function isAvailable(
  channel: NotificationChannel,
  availability: ChannelAvailability,
): boolean {
  switch (channel) {
    case "wallet_push":
      return availability.walletPush;
    case "web_push":
      return availability.webPush;
    case "wallet_silent":
      return availability.walletSilent;
    case "email":
      return availability.email;
    case "sms":
      return availability.sms;
  }
}

/**
 * Plan the effective transactional sends for a business event + a customer's
 * channel availability (PRD 80 §1). HARDCODED routing — the caller passes no
 * channel:
 *  1. Look up the trigger's category + candidate channels.
 *  2. Keep the candidates the customer is reachable on (Archive = the whole
 *     written trace across wallet/web/email; Temps-réel/Info statut = the push
 *     channels). A non-reachable channel is skipped.
 *  3. SMS extreme fallback (triggers 1/4/6/7 only): if the trigger is SMS-eligible
 *     AND the customer has NEITHER Wallet NOR Web Push AND has a phone, append an
 *     SMS send — marked NOT sendable (no provider V1).
 */
export function planTransactionalSends(
  trigger: TransactionalTrigger,
  availability: ChannelAvailability,
): PlannedSend[] {
  const category = categoryForTrigger(trigger);
  const sends: PlannedSend[] = channelsForTrigger(trigger)
    .filter((channel) => isAvailable(channel, availability))
    .map((channel) => ({ channel, category, sendable: true }));

  const hasPush = availability.walletPush || availability.webPush;
  if (smsFallbackEligible(trigger) && !hasPush && availability.sms) {
    sends.push({ channel: "sms", category, sendable: false });
  }

  return sends;
}
