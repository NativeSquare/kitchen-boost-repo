/**
 * PWA-S4 (#452) — `menu-deep-link` module API.
 *
 * Single pure decision consumed by `<MenuView>` to act on the `/menu`
 * URL search params (`?item=<id>` opens the item modal, `?promo=<id>`
 * scrolls + 2s highlights — US 62 + US 66 transitive).
 */
export {
  decideMenuDeepLink,
  type MenuDeepLinkAction,
  type SearchParamsLike,
} from "./decide-menu-deep-link";
