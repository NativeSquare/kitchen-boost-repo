"use client";

/**
 * PWA-S6a (#455) / S6b (#456) / S6c (#457) — `<PushEnrollmentModal>` — the
 * blocking push-enrollment modal (decisions-log Q8 « Modal single-screen
 * non-skippable »).
 *
 * Three visible modal steps (state machine pinned in `decideModalStep`):
 *  - `choice`             — header + incentive hook + Wallet primary + Web Push
 *                           secondary. Web Push is MASKED on iOS <16.4 via
 *                           `decideWebPushCapability` (US 35). The S6c fallback
 *                           link is rendered HERE at the bottom (12px muted)
 *                           once 2 channel failures have been recorded.
 *  - `wallet-loading`     — async install loader (US 33 / US 34) with
 *                           « Tester sans attendre » + « J'ai changé d'avis ».
 *  - `web-push-loading`   — Web Push permission flow (S6b #456): the
 *                           `<WebPushSubscribeButton>` continues to handle its
 *                           own internal state machine inside this step.
 *
 * Non-skippable (decisions-log Q8 « non-skippable Esc / click outside »):
 *  - `onEscapeKeyDown` / `onPointerDownOutside` preventDefault — Radix dialog
 *    primitive contract.
 *  - `showCloseButton={false}` — no × button.
 *  - Exits: (a) successful Wallet install / Web Push subscribe → Convex sub
 *    on `pushEnrollment.{walletStatus|webPushStatus}` flip → parent
 *    `<CheckoutForm>` re-runs `decidePaymentGate` → gate flips to active →
 *    `open={!gateActive}` (parent-controlled); (b) « J'ai changé d'avis » in
 *    either loader → back to choice (US 34); (c) S6c #457 — user exhausted
 *    the 3-level fallback → `markNoChannelPossible` flips the Convex sub on
 *    `pushEnrollment.noChannelPossible` → gate flips to active → modal closes.
 *
 * iOS <16.4 masking (US 35 + decisions-log Q8): the modal reads the runtime
 * capabilities at mount (`'PushManager' in window`, `'serviceWorker' in
 * navigator`, `'Notification' in window`) and pipes them through the pure
 * `decideWebPushCapability`. When unsupported, the Web Push section is
 * REMOVED from the choice screen — only the Wallet option is rendered. The
 * user never sees something that won't work.
 *
 * Failure counter (Q8 (5) + S6c #457): the modal SUMS two independent
 * failure sources, both counted as « documented refusal » per the issue
 * acceptance « 2 échecs Wallet + Web Push → lien fallback apparaît » :
 *  - Web Push refusals — bubbled up from `<WebPushSubscribeButton>` via its
 *    `onFailureCountChange` (the `decideWebPushBranch` reducer counts
 *    `denied / SubscribeFailed / RegisterFailed`).
 *  - Wallet refusals — each « J'ai changé d'avis » click during the
 *    wallet-loading screen (Q8 « Wallet refusé/timeout » counts as a
 *    documented failure). One click = one failure.
 * The sum is fed into `decideFallbackStep` via the `FailureCountReached`
 * event; the link surfaces at `>= FALLBACK_FAILURE_THRESHOLD` (= 2).
 *
 * S6c chain (the 3-level frictional fallback) is driven by `decideFallbackStep`
 * (pure) + rendered by `<NoNotifsFallback>` (the link + the 2 stacked confirm
 * dialogs + the terminal mutation). The modal owns the reducer state so the
 * parent's Convex sub can flip the gate without the fallback losing its
 * step on re-render.
 */
import { useState, useSyncExternalStore } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  type FallbackStep,
  type ModalStep,
  type WebPushCapability,
  decideFallbackStep,
  decideModalStep,
  decideWebPushCapability,
} from "@/lib/push-enrollment";
import { cn } from "@/lib/utils";
import { AddToWalletButton } from "./add-to-wallet-button";
import { NoNotifsFallback } from "./no-notifs-fallback";
import { WalletInstallLoader } from "./wallet-install-loader";
import { WebPushSubscribeButton } from "./web-push-subscribe-button";

/**
 * Probe the live browser capabilities for Web Push. Throws on the server (we
 * gate the call on `typeof window` via `useSyncExternalStore`'s
 * `getServerSnapshot`). The browser doesn't ship Push mid-session so we
 * don't subscribe to anything — the « store » never changes after mount.
 *
 * STABLE SNAPSHOT (React #185): `useSyncExternalStore` compares snapshots with
 * `Object.is` on EVERY render. `decideWebPushCapability(...)` builds a fresh
 * object each call, so returning it directly made every render look like a store
 * change → infinite re-render loop (« Maximum update depth exceeded ») the moment
 * the modal mounted on /checkout. The capability is constant for the page's
 * lifetime (the `window` globals never change), so we compute it ONCE and cache
 * the reference — every subsequent `getSnapshot` returns the same object.
 */
let cachedClientCapability: WebPushCapability | null = null;
function readClientCapability(): WebPushCapability {
  if (cachedClientCapability !== null) return cachedClientCapability;
  cachedClientCapability = decideWebPushCapability({
    hasPushManager: "PushManager" in window,
    hasServiceWorker:
      typeof navigator !== "undefined" && "serviceWorker" in navigator,
    hasNotification: "Notification" in window,
  });
  return cachedClientCapability;
}

/**
 * Stable no-op subscriber for `useSyncExternalStore`. The capability never
 * changes during the page's lifetime so we never need to notify React.
 */
function noopSubscribe(): () => void {
  return () => {};
}

/**
 * Server snapshot — the capability is unknown server-side; we return a stable
 * « pending » sentinel so the SSR HTML and the first client render agree
 * (avoids hydration mismatch). The post-hydration client snapshot then
 * surfaces the real capability — same render, no useEffect setState dance,
 * no `react-hooks/set-state-in-effect` violation.
 */
const PENDING_CAPABILITY: WebPushCapability = {
  kind: "unsupported",
  reason: "no-push-manager",
};
function getServerCapability(): WebPushCapability {
  return PENDING_CAPABILITY;
}

export type PushEnrollmentModalProps = {
  /** Controlled open state. The parent flips it to `false` once the gate is active. */
  open: boolean;
  /** The current resto (passed through to `<AddToWalletButton>` + `<WebPushSubscribeButton>`). */
  tenantId: Id<"tenants">;
  /**
   * Display name of the resto for the incentive hook (« -10% sur ta prochaine
   * cmd chez {Resto} »). Same source as `<CheckoutForm>` (the RSC parent
   * resolved it from the tenant cookie).
   */
  restoName: string;
};

export function PushEnrollmentModal({
  open,
  tenantId,
  restoName,
}: PushEnrollmentModalProps): React.JSX.Element {
  const [step, setStep] = useState<ModalStep>({ kind: "choice" });
  const [pendingSerial, setPendingSerial] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // S6c (#457) — independent counters per channel; the modal SUMS them and
  // feeds the total to `decideFallbackStep` so the fallback link surfaces
  // after `FALLBACK_FAILURE_THRESHOLD` (= 2) documented refusals across BOTH
  // channels (issue acceptance « 2 échecs Wallet + Web Push → lien apparaît »).
  const [webPushFailureCount, setWebPushFailureCount] = useState(0);
  const [walletFailureCount, setWalletFailureCount] = useState(0);
  const [fallbackStep, setFallbackStep] = useState<FallbackStep>({
    kind: "hidden",
  });
  // Single dispatch seam — bumps a failure counter AND drives the fallback
  // reducer in one geste. Dispatching at the same call-site as the failure
  // (vs. a derived useEffect) avoids cascading setState-in-effect renders
  // (react-hooks/set-state-in-effect) and keeps the FailureCountReached
  // event in lockstep with the actual counter bump.
  const bumpWebPushFailureCount = (next: number): void => {
    setWebPushFailureCount(next);
    setFallbackStep((prev) =>
      decideFallbackStep(prev, {
        kind: "FailureCountReached",
        count: next + walletFailureCount,
      }),
    );
  };
  const bumpWalletFailureCount = (): void => {
    setWalletFailureCount((wc) => {
      const next = wc + 1;
      setFallbackStep((prev) =>
        decideFallbackStep(prev, {
          kind: "FailureCountReached",
          count: webPushFailureCount + next,
        }),
      );
      return next;
    });
  };

  // `useSyncExternalStore` is the canonical way to read a non-reactive
  // browser capability into a React tree without violating
  // `react-hooks/set-state-in-effect` (the « `useEffect(() =>
  // setCapability(...))` » anti-pattern). The server snapshot is a stable
  // « pending → hide Web Push » sentinel so SSR HTML matches the first
  // client render; the client snapshot reads the real `window` globals on
  // mount and pins the verdict for the rest of the page lifetime.
  const capability = useSyncExternalStore<WebPushCapability>(
    noopSubscribe,
    readClientCapability,
    getServerCapability,
  );

  const onGenerated = (args: { serialNumber: string }): void => {
    setErrorMessage(null);
    setPendingSerial(args.serialNumber);
    setStep((s) => decideModalStep(s, { kind: "ClickWalletPrimary" }));
  };
  const onError = (message: string): void => {
    setErrorMessage(message);
  };
  const onChangeOfMind = (): void => {
    setPendingSerial(null);
    setStep((s) => decideModalStep(s, { kind: "ClickChangeOfMind" }));
    // S6c (#457) — « J'ai changé d'avis » during the Wallet loader is the
    // documented Wallet refusal/timeout (Q8 « Wallet refusé/timeout +
    // Web Push refusé »). Each click counts as ONE failure and feeds the
    // fallback reducer in the same call-site (no useEffect cascade).
    bumpWalletFailureCount();
  };

  // S6c (#457) — single dispatch seam for the fallback reducer. Wrapped in a
  // setter callback so concurrent events (Esc on the l2 modal + a click)
  // serialize through the same state machine.
  const onFallbackEvent = (
    event: Parameters<typeof decideFallbackStep>[1],
  ): void => {
    setFallbackStep((prev) => decideFallbackStep(prev, event));
  };

  // Conservative masking: the server snapshot pins « unsupported » so we
  // never flash an option on iOS <16.4 that won't work — once mounted, the
  // client snapshot returns the real verdict.
  const showWebPush = capability.kind === "supported";

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          // Non-skippable (decisions-log Q8): kill Esc + outside-click.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg outline-none sm:max-w-lg",
          )}
        >
          <DialogPrimitive.Title className="text-lg font-semibold text-black">
            Pour finaliser ta cmd, choisis comment recevoir ta confirmation +
            offres
          </DialogPrimitive.Title>

          <DialogPrimitive.Description className="text-sm text-zinc-600">
            🎁 -10% sur ta prochaine cmd chez{" "}
            <strong className="text-zinc-700">{restoName}</strong> dès que ta
            carte est ajoutée.
          </DialogPrimitive.Description>

          {step.kind === "choice" && (
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase text-emerald-700">
                  Option 1 — recommandée
                </p>
                <AddToWalletButton
                  tenantId={tenantId}
                  onGenerated={onGenerated}
                  onError={onError}
                />
                <p className="text-xs text-zinc-600">
                  2 taps · push sur ton écran de verrouillage.
                </p>
              </section>

              {showWebPush && (
                <section
                  className="flex flex-col gap-2"
                  data-testid="web-push-option"
                >
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    Option 2
                  </p>
                  <WebPushSubscribeButton
                    tenantId={tenantId}
                    onFailureCountChange={bumpWebPushFailureCount}
                  />
                  <p className="text-xs text-zinc-500">
                    1 tap · pas de lock-screen iOS.
                  </p>
                </section>
              )}

              {errorMessage !== null && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {errorMessage}
                </p>
              )}

              {/* S6c (#457) — fallback link surfaces only at the bottom of
                  the CHOICE screen, once 2 documented failures have been
                  recorded. The 2 confirm dialogs render OVER the modal via
                  Radix portal (separate z-index stack). */}
              <NoNotifsFallback
                tenantId={tenantId}
                step={fallbackStep}
                onFallbackEvent={onFallbackEvent}
              />
            </div>
          )}

          {step.kind === "wallet-loading" && pendingSerial !== null && (
            <WalletInstallLoader
              tenantId={tenantId}
              serialNumber={pendingSerial}
              onChangeOfMind={onChangeOfMind}
            />
          )}

          {/* S6b deliberately does NOT trigger `web-push-loading` from the
              modal step machine — the Web Push flow happens entirely inside
              the page (native permission popup + Convex sub close), so the
              `<WebPushSubscribeButton>` self-manages its busy/denied/error
              state in the `choice` screen. The `web-push-loading` step in
              `decideModalStep` is kept open for S6c #457 in case the
              fallback chain wants a dedicated loading screen for it. */}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
