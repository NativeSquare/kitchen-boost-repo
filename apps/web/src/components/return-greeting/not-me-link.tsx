"use client";

/**
 * PWA-S12 (#464) — `<NotMeLink>` : the discreet « Ce n'est pas moi → » link
 * rendered under the address-first form when the home RSC has resolved a
 * returning visitor (banner OR silent prefill).
 *
 * Thin `"use client"` shell — wires the React-y dependencies (Convex
 * `useAuthActions().signOut`, browser `fetch`, `window.location.reload`)
 * into the pure `makeNotMeHandlers` factory. The branching + ordering
 * lives in `not-me-link.handlers.ts` (tested under vitest node env).
 *
 * Visual treatment (decisions-log Q3, « lien petit en dessous, font-size
 * 12px color muted ») : small, muted, underlined on hover — explicitly
 * NOT a button (a button would suggest a primary action; this is an
 * escape hatch for device-shared families).
 *
 * Click flow :
 *   1. `signOut()` (Convex Auth) — clears localStorage JWT + refresh token.
 *   2. `fetch(SIGNOUT_API_PATH, { method: "POST" })` — clears the
 *      `__Host-…convexAuthJWT…` HttpOnly cookie via the route handler
 *      at `app/api/signout/route.ts`.
 *   3. `window.location.reload()` — visible disown : the next render
 *      reads no token, no fiche → no banner, empty form.
 *
 * The tenant cookie (`__Host-kb_tenant`) is INTENTIONALLY untouched
 * (Q3 « 2 cookies indépendants ») — the user stays on the same resto's
 * PWA, just as an anonymous first-visit visitor.
 */

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { SIGNOUT_API_PATH, makeNotMeHandlers } from "./not-me-link.handlers";

export function NotMeLink(): React.JSX.Element {
  const { signOut } = useAuthActions();
  // `pending` disables the link while the disown chain runs — prevents a
  // double click from racing two parallel signOut chains (the second
  // would no-op but pollute the console with warnings).
  const [pending, setPending] = useState(false);

  const { handleNotMe } = makeNotMeHandlers({
    signOut,
    postSignout: () =>
      fetch(SIGNOUT_API_PATH, {
        method: "POST",
        // No body — the cookie itself is the only handle the server
        // needs. Same shape as `/api/wallet-bridge/clear` (PWA-S9b).
        credentials: "same-origin",
      }),
    reload: () => window.location.reload(),
  });

  return (
    <button
      type="button"
      data-testid="return-greeting-not-me"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void handleNotMe();
        // No `finally` resetting `pending` to false : the chain always
        // ends with a hard reload, which unmounts everything.
      }}
      className="self-center text-xs text-zinc-500 underline-offset-2 hover:underline disabled:opacity-50"
    >
      Ce n&apos;est pas moi →
    </button>
  );
}
