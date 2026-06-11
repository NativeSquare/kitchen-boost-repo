/**
 * PWA delivery — pure predicate deciding whether the « Modifier l'adresse » row
 * (the explicit edit-address affordance, Uber-Eats parity) should render next
 * to the toggle, and with which address text.
 *
 * The gap it fills: once an address is set AND deliverable (« Livraison »
 * enabled), the reusable `<DeliveryAddressSheet>` only opens from a DISABLED
 * button tap (`decideDisabledDeliveryTap`). A customer who mistyped an address
 * that still geocodes as deliverable is otherwise stuck. This row gives the
 * always-available « show current address + Modifier » entry point that opens
 * the SAME sheet in `edit` mode.
 *
 * Splitting the decision out of the toggle keeps each branch vitest-pinned
 * (same discipline as `decideInitialMode` / `decideDisabledDeliveryTap`).
 *
 * Branch map :
 *  - deliverable verdict + known non-empty address → `{ show: true, address }`
 *    (trimmed). The only case that renders the row.
 *  - deliverable verdict + `undefined` address (fiche still loading) → hidden
 *    (no flash of a broken row).
 *  - deliverable verdict + empty / whitespace address → hidden (nothing to show
 *    or pre-fill).
 *  - non-deliverable verdict (hors_zone / hors_horaire / surge) → hidden; the
 *    disabled-button-opens-sheet path already covers those.
 *  - null verdict (address unknown) → hidden; same reason.
 */
import type { DeliveryQuoteVerdict } from "@/lib/address-first";

/** Whether to show the edit-address row, and the (trimmed) address to display. */
export type EditAddressRowDecision =
  | { show: true; address: string }
  | { show: false };

export function decideEditAddressRow(input: {
  verdict: DeliveryQuoteVerdict | null;
  currentAddress: string | undefined;
}): EditAddressRowDecision {
  // Only when the customer can actually be delivered (Livraison enabled) — the
  // disabled-button path owns every non-deliverable / unknown-verdict case.
  if (input.verdict === null || !input.verdict.deliverable) {
    return { show: false };
  }

  // No usable address (still loading, or empty/whitespace) ⇒ nothing to show or
  // to pre-fill the sheet with.
  if (input.currentAddress === undefined) return { show: false };
  const address = input.currentAddress.trim();
  if (address.length === 0) return { show: false };

  return { show: true, address };
}
