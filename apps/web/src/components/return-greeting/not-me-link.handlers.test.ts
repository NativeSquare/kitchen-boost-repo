/**
 * PWA-S12 (#464) — Tests for the pure `<NotMeLink>` handlers.
 *
 * The React component (`not-me-link.tsx`) is a thin `"use client"` shell that
 * wires Convex's `useAuthActions().signOut`, a `fetch` to `/api/signout`, and
 * `window.location.reload` into the handlers exposed here. The branching lives
 * in this module so vitest can pin it under `environment: "node"` — same
 * architectural split as `apps/admin/src/components/app/no-tenant-empty-state.handlers.test.ts`.
 *
 * Acceptance criteria pinned here (issue #464) :
 *   - « Click "Ce n'est pas moi →" → clear cookie + page reload → form vide
 *     + bandeau absent ».
 *
 * Ordering matters: we MUST clear BOTH the client-side localStorage tokens
 * (via `useAuthActions().signOut`) AND the server-side HttpOnly cookies
 * (via POST `/api/signout`) BEFORE reloading. If we reload first, the next
 * RSC `convexAuthNextjsToken()` would still see the cookie and the page
 * would still be authenticated for one render — flashing « Bonjour Sophie »
 * for a tick before the SDK catches up (the exact UX bug Q3 forbids).
 *
 * The tenant cookie (`__Host-kb_tenant`) is INTENTIONALLY untouched (Q3
 * cohabitation rule : « 2 cookies indépendants, aucune fusion ») — the
 * tenant resolution survives the disown action.
 */
import { describe, expect, it, vi } from "vitest";
import { SIGNOUT_API_PATH, makeNotMeHandlers } from "./not-me-link.handlers";

describe("NotMeLink — pure handlers", () => {
  it("`SIGNOUT_API_PATH` points at the POST `/api/signout` route handler", () => {
    // Pinned literal — the route handler at `apps/web/src/app/api/signout/
    // route.ts` MUST be reachable at this exact path. Centralising the
    // constant means the handler factory + the component + the route file
    // share ONE source of truth.
    expect(SIGNOUT_API_PATH).toBe("/api/signout");
  });

  it("`handleNotMe` clears localStorage tokens, clears server cookies, then reloads — in that order", async () => {
    const calls: string[] = [];
    const signOut = vi.fn(async () => {
      calls.push("signOut");
    });
    const postSignout = vi.fn(async () => {
      calls.push("postSignout");
    });
    const reload = vi.fn(() => {
      calls.push("reload");
    });

    const { handleNotMe } = makeNotMeHandlers({ signOut, postSignout, reload });
    await handleNotMe();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(postSignout).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // Strict ordering: client tokens → server cookies → reload. Any other
    // order leaves a window where the next render still sees a stale auth
    // state (Q3 « JAMAIS flash "Bonjour ..." après disown »).
    expect(calls).toEqual(["signOut", "postSignout", "reload"]);
  });

  it("`handleNotMe` still reloads when `signOut` rejects (best-effort: cookie clear + reload remain)", async () => {
    // localStorage clear may throw in private mode / quota exhaustion — but
    // the server-side cookie wipe + the reload are what GUARANTEE the
    // disown UX (the cookie is the authoritative session, the localStorage
    // copy is the client cache). We swallow the signOut error so the user
    // never gets stranded on a « Bonjour Sophie » page with a broken
    // « Ce n'est pas moi » link.
    const calls: string[] = [];
    const signOut = vi.fn(async () => {
      throw new Error("storage quota");
    });
    const postSignout = vi.fn(async () => {
      calls.push("postSignout");
    });
    const reload = vi.fn(() => {
      calls.push("reload");
    });

    const { handleNotMe } = makeNotMeHandlers({ signOut, postSignout, reload });
    await expect(handleNotMe()).resolves.toBeUndefined();
    expect(postSignout).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["postSignout", "reload"]);
  });

  it("`handleNotMe` still reloads when `postSignout` rejects (fall back to client-only disown)", async () => {
    // The fetch can fail offline / on a network blip. We still reload so the
    // user sees a fresh page; the localStorage clear above already removed
    // the client-side tokens. Worst case the HttpOnly cookie sticks until
    // its 365d TTL — acceptable degradation vs leaving the user stranded.
    const calls: string[] = [];
    const signOut = vi.fn(async () => {
      calls.push("signOut");
    });
    const postSignout = vi.fn(async () => {
      throw new Error("network");
    });
    const reload = vi.fn(() => {
      calls.push("reload");
    });

    const { handleNotMe } = makeNotMeHandlers({ signOut, postSignout, reload });
    await expect(handleNotMe()).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["signOut", "reload"]);
  });

  it("`handleNotMe` still reloads when BOTH signOut AND postSignout reject", async () => {
    // Worst-case degradation: client tokens cleared best-effort, server
    // cookie best-effort — the reload itself is the user-visible promise
    // of « ça s'est passé », so it MUST happen.
    const signOut = vi.fn(async () => {
      throw new Error("storage quota");
    });
    const postSignout = vi.fn(async () => {
      throw new Error("network");
    });
    const reload = vi.fn();

    const { handleNotMe } = makeNotMeHandlers({ signOut, postSignout, reload });
    await expect(handleNotMe()).resolves.toBeUndefined();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
