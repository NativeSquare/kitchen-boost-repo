/**
 * Pure reducer mapping a Convex query observation to a `SessionState`.
 *
 * Inputs model the three things a Convex `useQuery`-style hook can hand us:
 *   - `undefined`           → query in flight, no answer yet → `loading`
 *   - `Error`               → query threw (e.g. ConvexError `not_authenticated`)
 *                             → `unauthenticated`
 *   - `SessionData` payload → query resolved → `ready`
 *
 * Kept as a pure function (no React, no Convex import) so the state machine
 * is unit-testable in isolation and the React layer is a thin shell. This
 * mirrors the backend pattern of separating wire shape from business logic.
 */
import type { SessionData, SessionState } from "./types";

export type SessionSource = SessionData | Error | undefined;

export function toSessionState(source: SessionSource): SessionState {
  if (source === undefined) {
    return { status: "loading" };
  }
  if (source instanceof Error) {
    // Any thrown query is treated as "no usable session" at the transport
    // layer. The shell guard (a later tracer-bullet) is what decides whether
    // to redirect to /login or render a fallback — this hook only reports
    // the observation. ConvexError shape (`not_authenticated`, ...) carries
    // through the `Error` instance for callers that want to inspect it.
    return { status: "unauthenticated" };
  }
  return { status: "ready", session: source };
}
