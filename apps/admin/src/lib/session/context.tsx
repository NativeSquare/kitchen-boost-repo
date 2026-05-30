"use client";

/**
 * `SessionContext` / `SessionProvider` / `useSession` — the front-side
 * transport of the user's resolved session inside the `(app)` shell
 * (ADR 0014 §3). Pure plumbing: no garde, no redirect, no business logic.
 *
 * - `SessionProvider` takes a precomputed `state: SessionState` (the result
 *   of `toSessionState(source)`) and exposes it through context. The split
 *   between "compute state" (loader) and "broadcast state" (this file)
 *   keeps the Convex wiring swappable when backend D1 (`getSession`,
 *   story #162) lands — only the loader changes, not the provider/hook.
 * - `useSession()` returns the discriminated state. Outside a provider it
 *   throws (programmer error — the shell is always mounted under it).
 *
 * Garde + redirection (`isAdmin` ? root, `tenants` non-empty ? manager, else
 * "pas de resto rattaché") are the NEXT tracer-bullets and live in a
 * separate file consuming this hook.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { SessionState } from "./types";

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({
  state,
  children,
}: {
  state: SessionState;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
  );
}

/** Read the current session state from context. Throws outside provider. */
export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (state === null) {
    throw new Error(
      "useSession() must be used inside <SessionProvider /> (mounted in the (app) layout).",
    );
  }
  return state;
}

/** Test-only: export the raw context so React tests can wrap with custom
 * values without going through the loader. Not part of the public module
 * API (not re-exported from index.ts). */
export const __SessionContextForTesting = SessionContext;
