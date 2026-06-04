"use client";

/**
 * PWA-S6b (#456) — `<WebPushSubscribeButton>` — the « Autoriser les notifs »
 * CTA inside `<PushEnrollmentModal>` (US 35 + decisions-log Q8 « Flow Web Push
 * permission »).
 *
 * Flow (Q8 verbatim):
 *   1. Click → `Notification.requestPermission()` native popup
 *   2. granted → `serviceWorker.ready` → `pushManager.subscribe({
 *      applicationServerKey: VAPID_PUBLIC, userVisibleOnly: true })`
 *   3. Mutation `customer.webPush.register({ endpoint, p256dh, auth })` (the
 *      2.1-G mutation, already merged)
 *   4. Backend flips `pushEnrollment.webPushStatus = "enrolled"` → the parent
 *      `<CheckoutForm>`'s Convex sub re-runs `decidePaymentGate` → gate flips
 *      to `active` → modal closes via `open={!gateActive}` (parent-controlled,
 *      same mechanism as the Wallet branch).
 *   5. denied / default → inline « Refusé — essaie une autre option » +
 *      `failureCount` incremented in the reducer (read by S6c #457 to surface
 *      the « Continuer sans notifs » fallback link).
 *
 * IO around the pure `decideWebPushBranch` state machine: this component is
 * the « React adapter » — it dispatches events into the reducer, and it does
 * the actual browser IO (permission popup, SW ready, subscribe, mutation).
 * The reducer stays pinnable in vitest node env (no DOM mocking needed for
 * the state transitions); this file is the boundary where the IO happens.
 *
 * VAPID public key: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env var (PRD §10 PWA Q8 +
 * issue body « VAPID public key : `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env var. Lit
 * depuis env, ne hardcode pas »). When absent (CI / dev / forgotten config),
 * the component renders an « env not configured » error rather than throwing
 * — the modal stays usable.
 *
 * Capability masking is the parent modal's responsibility (`decideWebPushCapability`
 * → don't render this component at all on iOS <16.4). This file assumes the
 * capability check already passed.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  type WebPushBranchState,
  decideWebPushBranch,
  urlBase64ToUint8Array,
} from "@/lib/push-enrollment";

/**
 * Encode an `ArrayBuffer` into the url-safe base64 form the backend
 * `customer.webPush.register` mutation expects for `p256dh` / `auth`.
 *
 * `PushSubscription.getKey('p256dh')` / `.getKey('auth')` return `ArrayBuffer`
 * (or null on some old browsers — we never reach this path then because the
 * capability check already excluded them). The backend stores them as opaque
 * strings; we just need a stable encoding both sides agree on. URL-safe
 * base64 (no padding) is the convention `web-push` / RFC 8291 use end-to-end.
 */
function arrayBufferToBase64Url(buf: ArrayBuffer | null): string {
  if (buf === null) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const INITIAL_BRANCH: WebPushBranchState = { kind: "idle", failureCount: 0 };

export type WebPushSubscribeButtonProps = {
  /** Current resto (the wrapper arg for the `customerMutation`). */
  tenantId: Id<"tenants">;
  /**
   * Optional — let the parent observe failureCount flips (S6c #457 reads it
   * to decide whether to surface the fallback link).
   */
  onFailureCountChange?: (count: number) => void;
};

export function WebPushSubscribeButton({
  tenantId,
  onFailureCountChange,
}: WebPushSubscribeButtonProps): React.JSX.Element {
  const register = useMutation(api.lib.customer.webPush.register);
  const [branch, setBranch] = useState<WebPushBranchState>(INITIAL_BRANCH);

  // Single state-mutation seam — every transition flows through here so the
  // failureCount side-effect (parent observation) fires exactly once per flip.
  const dispatch = (event: Parameters<typeof decideWebPushBranch>[1]): void => {
    setBranch((prev) => {
      const next = decideWebPushBranch(prev, event);
      if (next.failureCount !== prev.failureCount && onFailureCountChange) {
        onFailureCountChange(next.failureCount);
      }
      return next;
    });
  };

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  const onClick = async (): Promise<void> => {
    // Defensive guards — the reducer would no-op these anyway, but bailing
    // early avoids triggering the native permission popup on a double-click.
    if (
      branch.kind === "requesting-permission" ||
      branch.kind === "subscribing" ||
      branch.kind === "registering" ||
      branch.kind === "registered"
    ) {
      return;
    }

    if (vapidPublicKey === "") {
      // Misconfig — surface as an "error" branch so the user sees the
      // « Refusé / essaie une autre option » inline message + failureCount++.
      dispatch({ kind: "ClickAuthorize" });
      dispatch({ kind: "PermissionDenied" });
      return;
    }

    dispatch({ kind: "ClickAuthorize" });

    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      // Some browsers (Safari) throw when called outside a user-gesture chain.
      // Treat as denied → counter increments, user can retry.
      dispatch({ kind: "PermissionDenied" });
      return;
    }

    if (permission !== "granted") {
      // « denied » OR « default » (user closed the popup without choosing) →
      // Q8 (5) « display inline "Refusé — essaie une autre option" + compteur
      // échecs incrémenté ».
      dispatch({ kind: "PermissionDenied" });
      return;
    }

    dispatch({ kind: "PermissionGranted" });

    let subscription: PushSubscription;
    try {
      const reg = await navigator.serviceWorker.ready;
      // PushManager.subscribe's lib.dom typing wants `BufferSource` whose
      // `buffer` is exactly `ArrayBuffer`. `urlBase64ToUint8Array` returns
      // `Uint8Array<ArrayBufferLike>` (TS 5.7 stricter typing) — we copy into
      // a freshly-allocated ArrayBuffer to make the narrowing safe at the
      // boundary. The bytes are identical.
      const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
      const applicationServerKey = new ArrayBuffer(keyBytes.length);
      new Uint8Array(applicationServerKey).set(keyBytes);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch {
      dispatch({ kind: "SubscribeFailed" });
      return;
    }

    dispatch({ kind: "SubscribeSucceeded" });

    try {
      await register({
        tenantId,
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64Url(subscription.getKey("p256dh")),
        auth: arrayBufferToBase64Url(subscription.getKey("auth")),
      });
    } catch {
      dispatch({ kind: "RegisterFailed" });
      return;
    }

    dispatch({ kind: "RegisterSucceeded" });
    // Modal close happens via the parent's Convex sub on
    // `pushEnrollment.webPushStatus = "enrolled"` flipping the gate to
    // `active` — no further work here.
  };

  const isBusy =
    branch.kind === "requesting-permission" ||
    branch.kind === "subscribing" ||
    branch.kind === "registering";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => {
          void onClick();
        }}
        disabled={isBusy || branch.kind === "registered"}
        aria-disabled={isBusy || branch.kind === "registered"}
        data-status={branch.kind}
        className={
          isBusy || branch.kind === "registered"
            ? "cursor-wait rounded-lg bg-emerald-600 px-4 py-3 text-base font-semibold text-white opacity-70"
            : "rounded-lg border border-emerald-700 px-4 py-3 text-base font-semibold text-emerald-800 hover:bg-emerald-50"
        }
      >
        {isBusy
          ? "Activation…"
          : branch.kind === "registered"
            ? "Notifs activées ✓"
            : branch.kind === "denied" || branch.kind === "error"
              ? "Réessayer"
              : "Autoriser les notifs"}
      </button>

      {(branch.kind === "denied" || branch.kind === "error") && (
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          Refusé — essaie une autre option.
        </p>
      )}
    </div>
  );
}
