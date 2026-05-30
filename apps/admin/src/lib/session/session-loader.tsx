"use client";

/**
 * `SessionLoader` — the Convex-bound client component that derives the
 * session state from the live source hook and feeds the `SessionProvider`.
 * Mounted in the `(app)` layout above the shell.
 *
 * No garde, no redirect: this is transport-only. Children always render,
 * and they consume the state through `useSession()`. The (future) garde +
 * "no resto rattaché" page are separate tracer-bullets.
 */
import type { ReactNode } from "react";
import { SessionProvider } from "./context";
import { toSessionState } from "./reducer";
import { useSessionSource } from "./session-source";

export function SessionLoader({ children }: { children: ReactNode }) {
  const source = useSessionSource();
  const state = toSessionState(source);
  return <SessionProvider state={state}>{children}</SessionProvider>;
}
