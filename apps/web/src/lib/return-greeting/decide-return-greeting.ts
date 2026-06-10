/**
 * PWA-S12 (#464) — Pure decision : « given the preloaded customer fiche,
 * what should the home RSC render above the address-first form? »
 *
 * Three branches per the decisions-log Q3 table (2026-06-04 PWA-Client) :
 *
 *   - `firstName` connu (checkout précédent terminé) → bandeau
 *     « Bonjour {firstName} 👋 » (warm, social, NO history mention).
 *   - `firstName` absent mais fiche présente (cookie OK, jamais payé) →
 *     pas de bandeau, juste pré-rempli silencieux du form. The `silent`
 *     branch still SIGNALS « fiche reconnue » so the RSC can render the
 *     « Ce n'est pas moi » disown link (no name to greet, but a session
 *     to disown nonetheless).
 *   - Pas de fiche du tout (cookie absent / 1ère visite) → `none` —
 *     ni bandeau, ni « Ce n'est pas moi » (rien à désavouer).
 *
 * Q3 SURVEILLANCE GUARDRAIL — the decision DELIBERATELY surfaces ONLY
 * `firstName`. The Q3 rule (« JAMAIS "On a ton adresse" / "Voici tes 4
 * dernières cmds" / historique explicite → flippant = surveillance, on
 * optimise pour hospitalité ») is enforced HERE by the type — any future
 * change adding `address` / `lastCheckoutAt` / etc. to the `banner` branch
 * will fail the pinned test that whitelists the shape.
 *
 * The IO surface (the `preloadQuery(getCurrentCustomer)` round-trip done by
 * `app/page.tsx`) is wired by the RSC itself — splitting « decide » from
 * « perform » lets vitest pin every branch in node env without DOM / Convex
 * deps (same shape as PWA-S6's `decideCheckoutPrefill`).
 */

/**
 * Minimal shape of `customers` row the greeting needs. All fields are
 * optional (the fiche may not have them yet — Sophie has not paid for
 * anything from this resto on this device).
 *
 * `address` is accepted here for caller convenience (the home RSC already
 * has the full snapshot) but the decision intentionally NEVER reads it —
 * see the « surveillance guardrail » test in `.test.ts`.
 */
export type CustomerGreetingSnapshot = {
  firstName?: string;
  address?: string;
};

/**
 * The verdict the RSC branches on. `kind: "banner"` carries ONLY `firstName`
 * (Q3 surveillance guardrail); `kind: "silent"` carries no payload (the
 * RSC just needs to know to render the disown link); `kind: "none"` is the
 * unrecognised case.
 */
export type ReturnGreeting =
  | { kind: "banner"; firstName: string }
  | { kind: "silent" }
  | { kind: "none" };

/**
 * Decide what to render above the address-first form for a returning visitor.
 * Defensive on `firstName` content: empty / whitespace-only falls back to
 * `silent` (never render « Bonjour  👋 ») and the surfaced name is
 * `.trim()`-ed.
 */
export function decideReturnGreeting(
  fiche: CustomerGreetingSnapshot | null,
): ReturnGreeting {
  if (fiche === null) return { kind: "none" };
  const firstName = fiche.firstName?.trim() ?? "";
  if (firstName === "") return { kind: "silent" };
  return { kind: "banner", firstName };
}
