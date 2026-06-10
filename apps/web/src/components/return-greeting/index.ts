/**
 * PWA-S12 (#464) — `return-greeting` components module API.
 *
 * The home RSC (`app/page.tsx`) renders:
 *  - `<GreetingBanner firstName={...} />` above the form when the
 *    `decideReturnGreeting` verdict is `{ kind: "banner" }`.
 *  - `<NotMeLink />` under the form when the verdict is either
 *    `{ kind: "banner" }` or `{ kind: "silent" }` (anything except
 *    the `none` first-visit branch).
 *
 * The pure decision lives at `@/lib/return-greeting` (vitest-pinned).
 */
export { GreetingBanner, type GreetingBannerProps } from "./greeting-banner";
export { NotMeLink } from "./not-me-link";
export {
  SIGNOUT_API_PATH,
  makeNotMeHandlers,
  type NotMeHandlerDeps,
  type NotMeHandlers,
} from "./not-me-link.handlers";
