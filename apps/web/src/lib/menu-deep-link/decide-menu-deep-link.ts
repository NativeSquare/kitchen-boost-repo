/**
 * PWA-S4 (#452) — `decideMenuDeepLink` — pure deep-link action derived from
 * the `/menu` URL `searchParams` (US 62 push marketing tenant, US 66 item
 * out-of-stock surface). Two params recognised V1: `?item=<id>` (open the
 * item modal) and `?promo=<id>` (scroll + 2s highlight pulse).
 *
 * Decisions pinned here so the component never re-derives:
 *  - `?item` wins over `?promo` (the explicit modal beats the highlight).
 *  - Empty / whitespace-only / undefined values map to `kind: "none"` (the
 *    eater PWA must NEVER throw on a malformed URL).
 *  - Array params (Next.js `string[]` shape for repeated keys) collapse to
 *    the FIRST entry — deterministic for any user-supplied URL.
 */

/** Shape `searchParams` takes in Next.js (page props / `useSearchParams`). */
export type SearchParamsLike = Record<string, string | string[] | undefined>;

/** The action `/menu` must perform after rendering the menu shell. */
export type MenuDeepLinkAction =
  | { kind: "none" }
  | { kind: "open-item-modal"; itemId: string }
  | { kind: "scroll-and-highlight"; itemId: string };

/**
 * Normalise a search param value to either its trimmed first string or null.
 * Returns null when the value is undefined / empty / whitespace-only.
 */
function pickFirst(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function decideMenuDeepLink(
  searchParams: SearchParamsLike,
): MenuDeepLinkAction {
  const itemId = pickFirst(searchParams.item);
  if (itemId !== null) {
    return { kind: "open-item-modal", itemId };
  }
  const promoId = pickFirst(searchParams.promo);
  if (promoId !== null) {
    return { kind: "scroll-and-highlight", itemId: promoId };
  }
  return { kind: "none" };
}
