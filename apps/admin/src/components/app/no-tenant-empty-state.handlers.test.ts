/**
 * F-SHELL-03 — Tests for the pure handlers/config behind `NoTenantEmptyState`.
 *
 * We can't render the React component in vitest here (the admin app's vitest
 * is `environment: "node"` — no jsdom, no RTL installed — see
 * `apps/admin/vitest.config.ts`). The same architectural split used by
 * `session-guard.decision.test.ts` applies: extract the branching into a pure
 * module, pin its behaviour exhaustively, keep the React layer a thin shell.
 *
 * Acceptance criteria of issue #169 pinned here:
 *   - « CTA "Contacter le support" ouvre `mailto:support@kitchen-boost.com` »
 *   - « Bouton "Se déconnecter" appelle `signOut` et redirige vers `/login` »
 *   - « Test : clic "Se déconnecter" → `signOut` appelé »
 *
 * The « rendu sans crash, les deux CTA présents » bullet is covered
 * structurally by the component using the same exported constants + handler
 * factory (typecheck + the handler test pin both CTAs' wiring).
 */
import { describe, expect, it, vi } from "vitest";
import {
  SIGN_OUT_REDIRECT_PATH,
  SUPPORT_MAILTO_HREF,
  makeNoTenantHandlers,
} from "./no-tenant-empty-state.handlers";

describe("NoTenantEmptyState — handlers/config", () => {
  it("`SUPPORT_MAILTO_HREF` is the canonical mailto for KitchenBoost support", () => {
    // Pinned: the address itself + the `mailto:` scheme. If anyone ever swaps
    // it for an in-app contact form, this test will (intentionally) fail and
    // force the swap to be explicit.
    expect(SUPPORT_MAILTO_HREF).toBe("mailto:support@kitchen-boost.com");
  });

  it("`SIGN_OUT_REDIRECT_PATH` lands on `/login` (matches existing `NavUser` behaviour)", () => {
    expect(SIGN_OUT_REDIRECT_PATH).toBe("/login");
  });

  it("`handleSignOut` awaits `signOut` then navigates to `/login`", async () => {
    const calls: string[] = [];
    const signOut = vi.fn(async () => {
      calls.push("signOut");
    });
    const navigate = vi.fn((path: string) => {
      calls.push(`navigate:${path}`);
    });

    const { handleSignOut } = makeNoTenantHandlers({ signOut, navigate });
    await handleSignOut();

    // Both side-effects fired exactly once.
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/login");
    // And in the right order — sign-out must complete BEFORE we redirect, or
    // the login page renders a still-authenticated session for a tick.
    expect(calls).toEqual(["signOut", "navigate:/login"]);
  });

  it("`handleSignOut` propagates a `signOut` rejection (does NOT redirect on failure)", async () => {
    const boom = new Error("network");
    const signOut = vi.fn(async () => {
      throw boom;
    });
    const navigate = vi.fn();

    const { handleSignOut } = makeNoTenantHandlers({ signOut, navigate });

    await expect(handleSignOut()).rejects.toBe(boom);
    // If sign-out fails, we MUST NOT navigate — otherwise the user lands on
    // /login but is still authenticated, and `SessionGuard` bounces them back
    // here, masking the error.
    expect(navigate).not.toHaveBeenCalled();
  });
});
