/**
 * PWA-S4 (#452) — `decideMenuDeepLink` — PURE function that derives the deep-link
 * action a `/menu` page must perform from its URL `searchParams`. Written
 * BEFORE the implementation (TDD red).
 *
 * Two URL params spec'd in the issue body (US 62, US 66 transitive):
 *  - `?item=<itemId>`  ⇒ open the item modal (sourced from the menu render).
 *  - `?promo=<itemId>` ⇒ scroll to the item + highlight (2s pulse) — comes
 *                        from a tenant push marketing campaign (US 62).
 *
 * Decisions pinned here (front never has to re-derive):
 *  - BOTH params present ⇒ `item` WINS (explicit deep link beats marketing
 *    surface — the user clicked a notification, the SW already stamped
 *    `?item=...` so `?promo=...` was layered before; the front opens the
 *    modal so the action is unambiguous, the highlight would be redundant
 *    behind the modal anyway).
 *  - Empty value (`?item=` or `?promo=`) ⇒ `kind: "none"` (treat as absent —
 *    a malformed URL must NEVER throw on the eater PWA).
 *  - Item id NOT in the rendered menu ⇒ caller's responsibility to handle
 *    (this pure decision does NOT cross-check the menu; the front no-ops on
 *    a missing target, no toast, no error — see PRD §10 "Edge cases").
 *
 * Why pure: the URL is the input; the action is the output; the decision is
 * stable on (searchParams). Keeping it pure lets vitest pin every branch in
 * node env without rendering React / mounting a router.
 */
import { describe, expect, it } from "vitest";
import { decideMenuDeepLink } from "./decide-menu-deep-link";

describe("decideMenuDeepLink — no params", () => {
  it("returns { kind: 'none' } on empty search params", () => {
    const action = decideMenuDeepLink({});
    expect(action.kind).toBe("none");
  });
});

describe("decideMenuDeepLink — ?item=<id> alone", () => {
  it("opens the modal targeting the given item id", () => {
    const action = decideMenuDeepLink({ item: "itm_smash_burger" });
    expect(action.kind).toBe("open-item-modal");
    if (action.kind !== "open-item-modal") throw new Error("unreachable");
    expect(action.itemId).toBe("itm_smash_burger");
  });
});

describe("decideMenuDeepLink — ?promo=<id> alone", () => {
  it("scrolls + highlights the promoted item (US 62 push marketing tenant)", () => {
    const action = decideMenuDeepLink({ promo: "itm_smash_burger" });
    expect(action.kind).toBe("scroll-and-highlight");
    if (action.kind !== "scroll-and-highlight") throw new Error("unreachable");
    expect(action.itemId).toBe("itm_smash_burger");
  });
});

describe("decideMenuDeepLink — both params present", () => {
  it("?item wins over ?promo (explicit modal beats marketing highlight)", () => {
    const action = decideMenuDeepLink({
      item: "itm_smash_burger",
      promo: "itm_other",
    });
    expect(action.kind).toBe("open-item-modal");
    if (action.kind !== "open-item-modal") throw new Error("unreachable");
    expect(action.itemId).toBe("itm_smash_burger");
  });
});

describe("decideMenuDeepLink — empty / malformed values", () => {
  it("treats empty `?item=` as absent (no throw on eater PWA)", () => {
    const action = decideMenuDeepLink({ item: "" });
    expect(action.kind).toBe("none");
  });

  it("treats empty `?promo=` as absent", () => {
    const action = decideMenuDeepLink({ promo: "" });
    expect(action.kind).toBe("none");
  });

  it("trims whitespace-only values down to absent", () => {
    const action = decideMenuDeepLink({ item: "   " });
    expect(action.kind).toBe("none");
  });
});

describe("decideMenuDeepLink — accepts string | string[] | undefined (Next.js searchParams shape)", () => {
  it("collapses an array param to its FIRST entry (URL ?item=a&item=b → a)", () => {
    // Next.js exposes repeated query params as `string[]`. We pin "first
    // wins" so the deep link is deterministic in face of a malformed URL.
    const action = decideMenuDeepLink({ item: ["itm_first", "itm_second"] });
    expect(action.kind).toBe("open-item-modal");
    if (action.kind !== "open-item-modal") throw new Error("unreachable");
    expect(action.itemId).toBe("itm_first");
  });

  it("ignores `undefined` (the shape Next.js uses for an absent param)", () => {
    const action = decideMenuDeepLink({ item: undefined, promo: undefined });
    expect(action.kind).toBe("none");
  });
});
