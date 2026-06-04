/**
 * PWA-S6 (#454) — pure decision returning the state of the "Payer X €" CTA
 * on `/checkout`, given the customer's
 * `pushEnrollment.{walletStatus, webPushStatus, a2hsStatus}` snapshot
 * (decisions-log Q8 « Détection canal actif côté front pour gate Payer »,
 * CONTEXT customer-data « Règle d'or V1 : tout client qui valide une cmd
 * doit avoir au moins UN canal Push enrollment actif »).
 *
 * The 3 statuses are the ones tracked by the backend chantier 2.1-G (already
 * merged) and stored on `customers.pushEnrollment` (ADR 0012). The pure
 * decision lives here so the React form (`<CheckoutForm>`) and a future
 * push-enrollment modal (S6a #455 / S6b #456 / S6c #457) can both consume
 * the same gate logic without re-implementing it.
 *
 * `PushChannelStatus` mirrors the backend `pushChannelStatus` union
 * (`packages/backend/convex/table/customers.ts`). We keep a LOCAL declaration
 * here so the front never depends on the backend module graph — only on the
 * stable wire shape. If the backend ever adds a status, this type is the
 * single front-side anchor to update + the gate test will fail loudly.
 */

/** Per-channel push enrollment status (mirror of backend `pushChannelStatus`). */
export type PushChannelStatus = "enrolled" | "not_enrolled" | "revoked";

/** Shape of `customers.pushEnrollment` as it lands on the wire. */
export type PushEnrollmentSnapshot = {
  walletStatus?: PushChannelStatus;
  webPushStatus?: PushChannelStatus;
  a2hsStatus?: PushChannelStatus;
  /**
   * PWA-S6c (#457) — escape hatch flipped by
   * `customer.pushEnrollment.markNoChannelPossible` after the 3-level
   * frictional fallback is exhausted (decisions-log Q8 (5), CONTEXT
   * customer-data « Push enrollment »). When `true` the Payer gate UNLOCKS
   * even with no enrolled push channel — the customer falls back to SMS
   * transactionnel via Cascade Notifications.
   */
  noChannelPossible?: boolean;
};

/** Channel identifier surfaced when the gate is active. */
export type EnrolledChannel =
  | "wallet"
  | "webPush"
  | "a2hs"
  | "noChannelPossible";

/** Reason the gate is disabled (only one shape V1 — kept open for future reasons). */
export type PaymentGateDisabledReason = "no-channel-enrolled";

/**
 * The state of the "Payer X €" CTA. Discriminated on `kind` so the consumer
 * branches exhaustively:
 *  - `active` : the user has ≥ 1 channel `"enrolled"`; the button is enabled
 *    and clicking it can proceed (S6 stub: `console.log`; S7 will trigger
 *    the actual Stripe payment).
 *  - `disabled` : the user has 0 channel enrolled; the button is greyed
 *    + a placeholder is shown explaining the next slice (S6a) will surface
 *    the push enrollment modal.
 */
export type PaymentGateState =
  | { kind: "active"; enrolledChannels: ReadonlyArray<EnrolledChannel> }
  | { kind: "disabled"; reason: PaymentGateDisabledReason };

/**
 * Decide the Payer gate state for a given push-enrollment snapshot.
 *
 * Rule (Q8 + CONTEXT customer-data) : iff AT LEAST ONE of
 * `walletStatus / webPushStatus / a2hsStatus` is `"enrolled"`, the button is
 * active. `not_enrolled` and `revoked` both count as « not enrolled » for the
 * gate — only the explicit `"enrolled"` literal opens the gate. An undefined
 * `pushEnrollment` (anonymous fiche, never enrolled) is equivalent to all
 * three being undefined → disabled.
 *
 * The Convex realtime subscription on `customers.pushEnrollment` (`useQuery`
 * on `getCurrentCustomer` in the client form) re-runs this decision on every
 * status flip — so a Wallet install or a Web Push subscription happening in
 * another tab unlocks the button without any reload (acceptance criterion
 * #454 : « install Wallet pendant client sur page → bouton se débloque
 * sans reload »).
 */
export function decidePaymentGate(
  pushEnrollment: PushEnrollmentSnapshot | undefined,
): PaymentGateState {
  const enrolledChannels: EnrolledChannel[] = [];
  if (pushEnrollment !== undefined) {
    if (pushEnrollment.walletStatus === "enrolled") {
      enrolledChannels.push("wallet");
    }
    if (pushEnrollment.webPushStatus === "enrolled") {
      enrolledChannels.push("webPush");
    }
    if (pushEnrollment.a2hsStatus === "enrolled") {
      enrolledChannels.push("a2hs");
    }
    // S6c (#457) — the no-channel fallback is APPENDED so a successfully-
    // enrolled push channel still leads the list (the SMS fallback is the
    // LAST-resort label). The flag alone is sufficient to unlock the gate
    // when nothing else is enrolled (~5% cases per Q8 (5)).
    if (pushEnrollment.noChannelPossible === true) {
      enrolledChannels.push("noChannelPossible");
    }
  }
  if (enrolledChannels.length === 0) {
    return { kind: "disabled", reason: "no-channel-enrolled" };
  }
  return { kind: "active", enrolledChannels };
}
