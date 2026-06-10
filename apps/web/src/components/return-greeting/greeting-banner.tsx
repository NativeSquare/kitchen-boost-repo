/**
 * PWA-S12 (#464) — `<GreetingBanner>` : the « Bonjour {firstName} 👋 » banner
 * rendered above the address-first form when the home RSC has resolved a
 * returning Sophie with a known `firstName`.
 *
 * Server component (no `"use client"`) — the verdict is computed in the
 * RSC (`app/page.tsx`) by `decideReturnGreeting`, and this component is a
 * pure rendering shell over the `banner` branch. Keeping it RSC means the
 * banner ships in the initial HTML stream (no FOUC, decisions-log Q3
 * « pas de pop-up "Re-bienvenue" »).
 *
 * Q3 SURVEILLANCE GUARDRAIL — the copy renders ONLY « Bonjour {firstName}
 * 👋 ». NO « On a ton adresse », NO « Voici tes N dernières cmds », NO
 * mention of any cached PII. The decision shape (`{ kind: "banner";
 * firstName }`) doesn't expose anything else, so the copy can't drift.
 */

export type GreetingBannerProps = {
  /** The firstName surfaced by `decideReturnGreeting`'s `banner` branch.
   * Pre-trimmed and non-empty (the decision guarantees this — see the
   * surveillance guardrail in `decide-return-greeting.test.ts`). */
  firstName: string;
};

export function GreetingBanner({
  firstName,
}: GreetingBannerProps): React.JSX.Element {
  return (
    <p
      data-testid="return-greeting-banner"
      className="text-lg font-medium text-black"
    >
      Bonjour {firstName} <span aria-hidden="true">👋</span>
    </p>
  );
}
