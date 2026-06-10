/**
 * PWA-S12 (#464) — Tests for the pure `decideReturnGreeting` decision.
 *
 * The decision answers ONE question: « given the preloaded customer fiche
 * (possibly `null`), what should the home RSC render above the address-first
 * form? ». Three branches per the decisions-log Q3 table (2026-06-04 PWA-Client) :
 *
 *   - `firstName` connu (checkout précédent terminé) → bandeau
 *     « Bonjour {firstName} 👋 » (warm, social, NO history mention).
 *   - `firstName` absent mais fiche présente (cookie OK, jamais payé) → AUCUN
 *     bandeau, juste pré-rempli silencieux du form.
 *   - Pas de fiche du tout (cookie absent / 1ère visite) → AUCUN bandeau.
 *
 * The greeting decision is the ONLY surface in the PWA that turns a customer
 * fiche into a visible « we recognise you » signal. The pure split lets us pin
 * the Q3 « hospitality vs surveillance » rule without DOM / Convex deps:
 * if a future change ever surfaces `address` / `lastCheckoutAt` in the banner
 * copy, the test contracts here will fail by construction (the decision shape
 * carries ONLY `firstName`).
 */
import { describe, expect, it } from "vitest";
import {
  type CustomerGreetingSnapshot,
  type ReturnGreeting,
  decideReturnGreeting,
} from "./decide-return-greeting";

describe("decideReturnGreeting — Q3 recognition retour rule", () => {
  it("returns `none` when the fiche is `null` (cookie absent / 1ère visite)", () => {
    // No fiche → no token / no customer row matched → the home renders the
    // generic « Indique-nous ton adresse » headline, no banner, no « Ce n'est
    // pas moi » link (nothing to disown).
    const greeting: ReturnGreeting = decideReturnGreeting(null);
    expect(greeting).toEqual({ kind: "none" });
  });

  it("returns `silent` when the fiche exists but has NO `firstName` (cookie present, jamais payé)", () => {
    // Sophie revient sur le même device mais n'a jamais finalisé un checkout
    // → on a son adresse (silent prefill) mais PAS son prénom → on doit
    // ABSOLUMENT ne pas afficher de bandeau (acted in decisions-log Q3 :
    // « cookie présent mais checkout jamais finalisé → aucun bandeau, juste
    // pré-rempli silencieux du form »). The `silent` branch exists so the
    // home can still render the « Ce n'est pas moi » link (the fiche is
    // recognisable as the device's fiche, even without a name).
    const fiche: CustomerGreetingSnapshot = { address: "10 rue de la Paix" };
    expect(decideReturnGreeting(fiche)).toEqual({ kind: "silent" });
  });

  it("returns `silent` when `firstName` is the empty string (defensive: never greet « Bonjour  »)", () => {
    // Convex stores `firstName` as `v.optional(v.string())`, so the empty
    // string is reachable (a future bug in `recordConsentAtCheckout` could
    // stamp it). We treat `""` exactly like `undefined` to guarantee we
    // NEVER render a literal « Bonjour  👋 » with a hole where the name
    // should be — that would look broken on terrain.
    const fiche: CustomerGreetingSnapshot = { firstName: "" };
    expect(decideReturnGreeting(fiche)).toEqual({ kind: "silent" });
  });

  it("returns `silent` when `firstName` is whitespace only (defensive: trim before greeting)", () => {
    // Same intent as the empty-string case — a stray space from a paste
    // accident must not produce a « Bonjour   👋 » banner.
    const fiche: CustomerGreetingSnapshot = { firstName: "   " };
    expect(decideReturnGreeting(fiche)).toEqual({ kind: "silent" });
  });

  it("returns `banner` carrying the firstName when the fiche has a non-empty `firstName`", () => {
    // Sophie a finalisé un checkout précédent → `recordConsentAtCheckout` a
    // stampé son `firstName` sur la fiche → on l'accueille (PRD Q3 « warm,
    // social, pas d'historique mentionné »). The decision surfaces ONLY
    // the firstName — the renderer concatenates the « Bonjour … 👋 » copy.
    const fiche: CustomerGreetingSnapshot = { firstName: "Sophie" };
    expect(decideReturnGreeting(fiche)).toEqual({
      kind: "banner",
      firstName: "Sophie",
    });
  });

  it("trims the firstName before surfacing it (no leading/trailing whitespace in the banner)", () => {
    // Defensive: the input field on `/checkout` is `<input>` (no auto-trim),
    // so a user typing « Sophie  » lands a trailing space in the fiche.
    // The banner must read « Bonjour Sophie 👋 » — not « Bonjour Sophie   👋 ».
    const fiche: CustomerGreetingSnapshot = { firstName: "  Sophie  " };
    expect(decideReturnGreeting(fiche)).toEqual({
      kind: "banner",
      firstName: "Sophie",
    });
  });

  it("does NOT surface `address` (Q3 surveillance guardrail : NEVER « on a ton adresse »)", () => {
    // Critical guardrail (decisions-log Q3 : « JAMAIS "On a ton adresse" / …
    // → flippant = surveillance, on optimise pour hospitalité »). The
    // decision shape DELIBERATELY carries ONLY `firstName` — adding any
    // other PII field here would break the contract this test pins.
    const fiche: CustomerGreetingSnapshot = {
      firstName: "Sophie",
      address: "10 rue de la Paix",
    };
    const greeting = decideReturnGreeting(fiche);
    // If we ever add an `address` field to the banner branch, this `in` check
    // fails — forcing the change to be explicit + reviewed.
    if (greeting.kind === "banner") {
      expect("address" in greeting).toBe(false);
      expect(Object.keys(greeting).sort()).toEqual(["firstName", "kind"]);
    } else {
      throw new Error("expected banner branch");
    }
  });
});
