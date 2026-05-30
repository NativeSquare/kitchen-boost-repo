/**
 * Module API — F-SHELL-01 session plumbing.
 *
 * Public surface consumed by the (app) shell and downstream tracer-bullets
 * (garde, switcher, useTenantQuery). Anything not re-exported here is
 * internal and may change.
 */
export { SessionProvider, useSession } from "./context";
export { SessionLoader } from "./session-loader";
export { toSessionState } from "./reducer";
export type { SessionSource } from "./reducer";
export type {
  SessionData,
  SessionState,
  SessionStatus,
  SessionTenant,
} from "./types";
