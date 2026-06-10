/**
 * PWA-S12 (#464) — `return-greeting` module API.
 *
 * The home RSC (`app/page.tsx`) consumes:
 *  - `decideReturnGreeting(fiche)` → pure verdict carrying the firstName
 *    when the fiche has one, or signalling the silent / none branches.
 *
 * The Q3 « hospitality vs surveillance » UX rule (decisions-log 2026-06-04
 * PWA-Client) lives in `decideReturnGreeting`. Splitting « decide » from
 * « render » lets vitest pin the rule in node env without DOM / Convex deps.
 *
 * The `<GreetingBanner>` (server component) + `<NotMeLink>` (client) live
 * under `components/return-greeting/` and consume the verdict produced here.
 */
export {
  type CustomerGreetingSnapshot,
  type ReturnGreeting,
  decideReturnGreeting,
} from "./decide-return-greeting";
