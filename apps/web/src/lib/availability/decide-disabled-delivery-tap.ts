/**
 * FEATURE B (#reusable delivery-address sheet) — pure predicate mapping the
 * cached delivery verdict × live open/closed state onto the action a tap on the
 * DISABLED « Livraison » button must perform. Splitting the decision out of the
 * toggle keeps every branch vitest-pinned (same discipline as
 * `decideInitialMode` / `decideAddressFirstAction`).
 *
 * A disabled button must NEVER be a dead tap (issue spec). The outcomes:
 *  - `closed-sheet`   — defer to Feature A's closed UX (resto fermé): a delivery
 *                       quote is pointless when closed, so the address sheet is
 *                       NOT offered. Wins when the live state is closed OR the
 *                       cached verdict reason is `hors_horaire`.
 *  - `address-prompt` — open the reusable address sheet with the « renseigne »
 *                       copy (verdict unknown — fresh-tab deep-link, US: a direct
 *                       deep-link into /menu with no prior address-first run).
 *  - `address-edit`   — open the reusable address sheet PRE-FILLED with the
 *                       « modifie » copy (address known but not deliverable:
 *                       `hors_zone`, or transient `surge`).
 *  - `none`           — the button is enabled (deliverable), so a tap is the
 *                       normal mode switch; this predicate is a no-op.
 */
import type { DeliveryQuoteVerdict } from "@/lib/address-first";

/** The action a tap on the disabled « Livraison » button resolves to. */
export type DisabledDeliveryTapAction =
  | "closed-sheet"
  | "address-prompt"
  | "address-edit"
  | "none";

export function decideDisabledDeliveryTap(input: {
  verdict: DeliveryQuoteVerdict | null;
  isOpen: boolean;
}): DisabledDeliveryTapAction {
  // Closed wins first — Feature A owns the UX; no address quote when closed.
  if (!input.isOpen) return "closed-sheet";

  const verdict = input.verdict;
  // No verdict yet ⇒ the address is unknown ⇒ prompt for it.
  if (verdict === null) return "address-prompt";

  // A deliverable verdict means the button is enabled — nothing to do here.
  if (verdict.deliverable) return "none";

  switch (verdict.reason) {
    case "hors_horaire":
      // The verdict says the resto was closed when quoted; defer to the closed
      // UX even if the live `isOpen` momentarily disagrees (Feature A's live
      // re-eval reconciles the two).
      return "closed-sheet";
    case "hors_zone":
    case "surge":
      // Address known but not deliverable (out of zone) or transiently blocked
      // (surge) ⇒ let the customer edit / retry the address in the sheet.
      return "address-edit";
    default: {
      const _exhaustive: never = verdict.reason;
      throw new Error(
        `Unhandled delivery verdict reason: ${String(_exhaustive)}`,
      );
    }
  }
}
