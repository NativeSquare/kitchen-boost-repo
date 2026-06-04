/**
 * PWA-S3 (#451) — pure routing decision returning the UI action to perform
 * after the address-first chain resolves into a delivery verdict.
 *
 * The `<AddressFirstForm>` (client) component consumes this pure function to
 * branch on the 4 verdicts spec'd in decisions-log Q7 — splitting "decide"
 * from "perform" lets the side-effects (navigation, toast, re-fire quote)
 * live in the component while every branch is pinned by vitest in node env.
 * Same shape as `tenant-resolver/decide-tenant-resolution` (PWA-S1) and
 * `pwa-manifest/decide-manifest` (PWA-S2).
 *
 * `DeliveryQuoteVerdict` mirrors the wire shape of
 * `lib/delivery/quote.DeliveryQuoteVerdict` (the backend action's return). We
 * keep a LOCAL declaration here so the front never depends on backend internals
 * (Convex `Doc`/`Id` etc.) — only on the stable wire shape. If the backend
 * ever changes the verdict, this type is the single front-side anchor to
 * update + the test will fail loudly.
 */

/** The 3 non-deliverable reasons surfaced by the backend `requestDeliveryQuote`. */
export type DeliveryQuoteReason = "hors_zone" | "hors_horaire" | "surge";

/** Mirror of backend `DeliveryQuoteVerdict` — kept local on purpose (see above). */
export type DeliveryQuoteVerdict =
  | { deliverable: true; fee: number; eta: number; quoteId: string }
  | { deliverable: false; reason: DeliveryQuoteReason };

/**
 * The UI action the form should perform after a verdict resolves. Two shapes:
 *  - `redirect` to `/menu` (delivery verdict OK) — carries fee/eta/quoteId so
 *    `/menu` can render the toggle without re-quoting (PRD Q7 (3): two modes
 *    cached in the verdict initial).
 *  - `show-message` (any non-deliverable) — the form stays on `/` and renders
 *    the reason-specific message + optionally a CTA + optionally a Retry button.
 */
export type AddressFirstAction =
  | {
      kind: "redirect";
      path: "/menu";
      mode: "delivery";
      fee: number;
      eta: number;
      quoteId: string;
    }
  | {
      kind: "show-message";
      reason: DeliveryQuoteReason;
      /** Present iff the user has a non-Retry alternative (C&C on hors_zone). */
      cta?: { label: string; path: "/menu"; mode: "click_and_collect" };
      /** True iff the failure is transient and the form should expose a Retry. */
      canRetry: boolean;
    };

/**
 * Decide the post-verdict UI action.
 *
 * Branch map (US 2-8, decisions-log Q7):
 *  - `deliverable: true`  → redirect `/menu`, mode `delivery`.
 *  - `hors_zone`          → message + CTA "Voir le menu (retrait sur place)"
 *                           → `/menu` in C&C mode.
 *  - `hors_horaire`       → message « Le resto est fermé, ouvre à XXh ». No CTA
 *                           (V1 has no pre-ordering — C&C is unavailable too
 *                           when the resto is closed, ADR-aligned with the
 *                           backend service-hours gate in
 *                           `lib/delivery/quote.crossQuoteWithServiceHours`).
 *  - `surge`              → message « Indisponible à cet horaire, réessaie » +
 *                           Retry (`canRetry: true`) — same address, re-fire
 *                           `requestDeliveryQuote`, no signIn/updateAddress
 *                           re-needed (idempotent).
 */
export function decideAddressFirstAction(
  verdict: DeliveryQuoteVerdict,
): AddressFirstAction {
  if (verdict.deliverable) {
    return {
      kind: "redirect",
      path: "/menu",
      mode: "delivery",
      fee: verdict.fee,
      eta: verdict.eta,
      quoteId: verdict.quoteId,
    };
  }
  switch (verdict.reason) {
    case "hors_zone":
      return {
        kind: "show-message",
        reason: "hors_zone",
        cta: {
          label: "Voir le menu (retrait sur place)",
          path: "/menu",
          mode: "click_and_collect",
        },
        canRetry: false,
      };
    case "hors_horaire":
      return {
        kind: "show-message",
        reason: "hors_horaire",
        canRetry: false,
      };
    case "surge":
      return {
        kind: "show-message",
        reason: "surge",
        canRetry: true,
      };
    default: {
      // Exhaustiveness check (compile-time): a new reason without a branch
      // here is a type error, caught at build time before the runtime ever
      // sees an unexpected verdict.
      const _exhaustive: never = verdict.reason;
      throw new Error(
        `Unhandled delivery verdict reason: ${String(_exhaustive)}`,
      );
    }
  }
}
