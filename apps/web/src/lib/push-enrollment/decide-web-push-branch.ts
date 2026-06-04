/**
 * PWA-S6b (#456) — `decideWebPushBranch` — pure state machine for the Web Push
 * sub-flow inside `<PushEnrollmentModal>` (US 35 + decisions-log Q8 « Flow
 * Web Push permission »).
 *
 * Q8 flow (verbatim):
 *   1. Clic "Autoriser les notifs" → `Notification.requestPermission()` popup
 *   2. granted → `serviceWorker.ready` then `pushManager.subscribe({
 *      applicationServerKey: VAPID_PUBLIC, userVisibleOnly: true })`
 *   3. Mutation `customer.webPush.register({ endpoint, p256dh, auth })`
 *   4. Backend flips `pushEnrollment.webPushStatus = "enrolled"` → Convex sub
 *      flips the gate → parent modal closes
 *   5. denied / default → display « Refusé — essaie une autre option » + the
 *      failure counter increments (re-used by the S6c fallback to decide
 *      whether to surface the « Continuer sans notifs » link)
 *
 * Transitions:
 *   idle                  -- ClickAuthorize     --> requesting-permission
 *   requesting-permission -- PermissionGranted  --> subscribing
 *   requesting-permission -- PermissionDenied   --> denied   (failureCount++)
 *   subscribing           -- SubscribeSucceeded --> registering
 *   subscribing           -- SubscribeFailed    --> error    (failureCount++)
 *   registering           -- RegisterSucceeded --> registered
 *   registering           -- RegisterFailed     --> error    (failureCount++)
 *   denied                -- ClickAuthorize     --> requesting-permission (count kept)
 *   error                 -- ClickAuthorize     --> requesting-permission (count kept)
 *
 * The `registered` step is TERMINAL inside this reducer — the actual modal
 * close happens via the parent's Convex sub on
 * `customers.pushEnrollment.webPushStatus = "enrolled"` (same pattern as the
 * Wallet path). Modelling the auto-close inside the reducer would couple the
 * pure decision to the gate logic.
 *
 * `failureCount` is part of the state and is NEVER reset on retry (the user
 * who denies, retries, denies again, still has 2 documented failures — that's
 * what S6c reads to surface the fallback link). Q8 (5) calls this out
 * explicitly.
 *
 * Every (state, event) pair NOT in the transition table is a no-op — the
 * reducer silently swallows stray events (double-clicks, late
 * PermissionGranted after the user already retried, etc.).
 */

export type WebPushBranchStateKind =
  | "idle"
  | "requesting-permission"
  | "subscribing"
  | "registering"
  | "registered"
  | "denied"
  | "error";

export type WebPushBranchState = {
  kind: WebPushBranchStateKind;
  /** Number of documented failures (denied / subscribe failed / register
   * failed). Persisted across retries — S6c reads this to surface the
   * « Continuer sans notifs » fallback link. */
  failureCount: number;
};

export type WebPushBranchEvent =
  | { kind: "ClickAuthorize" }
  | { kind: "PermissionGranted" }
  | { kind: "PermissionDenied" }
  | { kind: "SubscribeSucceeded" }
  | { kind: "SubscribeFailed" }
  | { kind: "RegisterSucceeded" }
  | { kind: "RegisterFailed" };

export function decideWebPushBranch(
  current: WebPushBranchState,
  event: WebPushBranchEvent,
): WebPushBranchState {
  switch (current.kind) {
    case "idle": {
      if (event.kind === "ClickAuthorize") {
        return {
          kind: "requesting-permission",
          failureCount: current.failureCount,
        };
      }
      return current;
    }
    case "requesting-permission": {
      if (event.kind === "PermissionGranted") {
        return { kind: "subscribing", failureCount: current.failureCount };
      }
      if (event.kind === "PermissionDenied") {
        return {
          kind: "denied",
          failureCount: current.failureCount + 1,
        };
      }
      return current;
    }
    case "subscribing": {
      if (event.kind === "SubscribeSucceeded") {
        return { kind: "registering", failureCount: current.failureCount };
      }
      if (event.kind === "SubscribeFailed") {
        return { kind: "error", failureCount: current.failureCount + 1 };
      }
      return current;
    }
    case "registering": {
      if (event.kind === "RegisterSucceeded") {
        return { kind: "registered", failureCount: current.failureCount };
      }
      if (event.kind === "RegisterFailed") {
        return { kind: "error", failureCount: current.failureCount + 1 };
      }
      return current;
    }
    case "denied":
    case "error": {
      if (event.kind === "ClickAuthorize") {
        // Retry — failureCount is INTENTIONALLY preserved across retries.
        return {
          kind: "requesting-permission",
          failureCount: current.failureCount,
        };
      }
      return current;
    }
    case "registered": {
      // Terminal — the Convex sub on `webPushStatus = "enrolled"` is what
      // closes the modal. Any further event here is a no-op (the component
      // is about to unmount).
      return current;
    }
    default: {
      const _exhaustive: never = current.kind;
      return _exhaustive;
    }
  }
}
