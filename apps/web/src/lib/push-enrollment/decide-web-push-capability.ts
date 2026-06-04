/**
 * PWA-S6b (#456) — `decideWebPushCapability` — the pure capability check the
 * `<PushEnrollmentModal>` consults to decide whether to render the Web Push
 * option at all (US 35 + decisions-log Q8 « Cas iOS < 16.4 ou iOS sans A2HS :
 * `'PushManager' in window === false` détecté côté front → option Web Push
 * masquée par le modal »).
 *
 * The function takes 3 booleans rather than touching the live globals so it
 * stays node-pinnable + lets the React caller decide how to probe each:
 *   - `hasPushManager`   = `'PushManager' in window`
 *   - `hasServiceWorker` = `'serviceWorker' in navigator`
 *   - `hasNotification`  = `'Notification' in window`
 *
 * Returning a discriminated union (rather than a boolean) keeps the « reason »
 * available for analytics / debugging without forcing the caller to re-probe.
 * The reason isn't surfaced in the UI (we just hide the option), but the
 * Sentry breadcrumb the caller drops uses it.
 *
 * Priority order matters for the « all three missing » case (e.g. an ancient
 * non-PWA browser): `no-push-manager` wins because that is THE detection
 * axis the Q8 spec calls out — iOS <16.4 surfaces here as the headline case,
 * and the other two reasons are rare safety nets.
 */

/** Why the modal masks the Web Push option (analytics-friendly enum). */
export type WebPushUnsupportedReason =
  | "no-push-manager"
  | "no-service-worker"
  | "no-notification";

/** The verdict the modal consumes to decide whether to render the Web Push CTA. */
export type WebPushCapability =
  | { kind: "supported" }
  | { kind: "unsupported"; reason: WebPushUnsupportedReason };

export type DecideWebPushCapabilityInput = {
  /** `'PushManager' in window` — false on iOS <16.4 (US 35 target). */
  hasPushManager: boolean;
  /** `'serviceWorker' in navigator` — false on legacy non-SW browsers. */
  hasServiceWorker: boolean;
  /** `'Notification' in window` — false on some private-browsing builds. */
  hasNotification: boolean;
};

export function decideWebPushCapability(
  input: DecideWebPushCapabilityInput,
): WebPushCapability {
  if (!input.hasPushManager) {
    // Headline case — iOS <16.4 (US 35). Priority over the other two so the
    // breadcrumb names the most-likely root cause.
    return { kind: "unsupported", reason: "no-push-manager" };
  }
  if (!input.hasServiceWorker) {
    return { kind: "unsupported", reason: "no-service-worker" };
  }
  if (!input.hasNotification) {
    return { kind: "unsupported", reason: "no-notification" };
  }
  return { kind: "supported" };
}
