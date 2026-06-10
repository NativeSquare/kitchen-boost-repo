"use client";

/**
 * PWA-S11 (#463) — `<IOSInstallBottomSheet>` — iOS A2HS instructional
 * bottom-sheet rendered on `/c/[orderId]` state T+0 « Cmd reçue »
 * (decisions-log Q4, US 58).
 *
 * Why on the tracking page T+0 :
 *  - The user JUST paid. Endorphin moment + the screen they'll see again
 *    next time they revisit the order (deep-link from the confirmation
 *    email / push). Maximum likelihood of friction tolerance and best
 *    install hook (« mets ce resto sur ton écran »).
 *  - Mirror of #462 « post-cart » trigger : the install prompt is offered
 *    AFTER the user demonstrated intent (cart for Android, paid for iOS) —
 *    not at first contact (low-intent visitor would dismiss).
 *
 * Visibility — 4 gates via `decideIosBottomSheetVisibility` (pure decision,
 * `lib/a2hs-ios`) :
 *   1. iOS Safari ONLY (US 58 + AC 4 « Android → bottom sheet n'apparaît
 *      jamais »). UA sniff via `isIosSafari(navigator.userAgent)`.
 *   2. NOT already standalone (US 59 — already installed, nothing to
 *      instruct).
 *   3. `a2hsStatus !== "enrolled"` (backend already knows we installed —
 *      heuristique S11 ran on a previous visit).
 *   4. NOT dismissed this session (« OK plus tard » sessionStorage flag,
 *      same shape as `<WalletPromptBanner>` palier 2 #460).
 *
 * Contents — placeholder SVG illustration of the 3 steps :
 *   Safari → Share icon → « Sur l'écran d'accueil » → « Ajouter ».
 *   The PRD/issue mentions a GIF; we ship the same placeholder pattern as
 *   #459 (HITL-3 Lottie assets pending — SVG placeholders, cosmetic swap
 *   later via separate PR). The SVG illustrates the same 3-step flow with
 *   the canonical Safari icons + an animated pulse on the « Ajouter » CTA
 *   to mimic the GIF loop. Compatible 4G mobile (< 2KB inline).
 *
 * Dismiss UX :
 *   « OK plus tard » button writes `kb_a2hs_ios_sheet_dismissed = "1"` to
 *   sessionStorage + closes the Drawer. Same hydration discipline as
 *   `<WalletPromptBanner>` (#460) — `useSyncExternalStore` so the SSR
 *   snapshot pins `dismissed = false` (sheet considered for render) and the
 *   client snapshot reads the real flag on mount. The Drawer's own dismiss
 *   gestures (swipe-down, click-outside, Esc) ALSO route through `onDismiss`
 *   so all three paths converge on the same sessionStorage write.
 *
 * Standalone subscription :
 *   Mirrors #462 — `useSyncExternalStore(subscribeIsStandalone, ...)` so a
 *   user installing mid-session (rare but possible if they follow the
 *   instructions and re-tap the share link the email contains) flips
 *   `isStandalone = true` → the decision returns `hidden / already-standalone`
 *   → the sheet unmounts without a manual close.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  A2HS_IOS_SHEET_DISMISS_KEY,
  decideIosBottomSheetVisibility,
  isIosSafari,
} from "@/lib/a2hs-ios";

const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

// ---------------------------------------------------------------------------
// External-store helpers — same pattern as <AndroidInstallButton> (#462) +
// <WalletPromptBanner> (#460) to avoid hydration mismatch with browser-only
// state (matchMedia + sessionStorage).
// ---------------------------------------------------------------------------

function readIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia(STANDALONE_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

function getServerIsStandalone(): boolean {
  return false;
}

function subscribeIsStandalone(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let mql: MediaQueryList;
  try {
    mql = window.matchMedia(STANDALONE_MEDIA_QUERY);
  } catch {
    return () => {};
  }
  const onChange = (): void => notify();
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(A2HS_IOS_SHEET_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerDismissed(): boolean {
  return false;
}

function subscribeDismissed(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent): void => {
    if (e.key === A2HS_IOS_SHEET_DISMISS_KEY) notify();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function readUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent ?? "";
}

function getServerUserAgent(): string {
  return "";
}

function subscribeUserAgent(_notify: () => void): () => void {
  // UA is static within a session — no need to subscribe, but
  // useSyncExternalStore requires the function signature.
  return () => {};
}

export type IOSInstallBottomSheetProps = {
  /** Resto id — wrapper arg for `getCurrentCustomer` (Convex sub on `a2hsStatus`). */
  tenantId: Id<"tenants">;
};

export function IOSInstallBottomSheet({
  tenantId,
}: IOSInstallBottomSheetProps): React.JSX.Element | null {
  const isStandalone = useSyncExternalStore<boolean>(
    subscribeIsStandalone,
    readIsStandalone,
    getServerIsStandalone,
  );
  const dismissed = useSyncExternalStore<boolean>(
    subscribeDismissed,
    readDismissed,
    getServerDismissed,
  );
  const userAgent = useSyncExternalStore<string>(
    subscribeUserAgent,
    readUserAgent,
    getServerUserAgent,
  );
  const isIos = useMemo(() => isIosSafari(userAgent), [userAgent]);

  const customer = useQuery(api.lib.customer.identity.getCurrentCustomer, {
    tenantId,
  });
  const a2hsStatus = customer?.pushEnrollment?.a2hsStatus;

  // PWA-S11 safety net : the sheet itself is iOS-only, but the user may
  // still flip `standalone` from inside (re-tap the email link after
  // installing). Mirror of the <AndroidInstallButton> appinstalled effect.
  // Idempotent backend (audit row trail is intentional).
  const recordA2hsAccepted = useMutation(
    api.lib.customer.pushEnrollment.recordA2hsAccepted,
  );
  useEffect(() => {
    if (!isStandalone) return;
    if (a2hsStatus === "enrolled") return;
    void recordA2hsAccepted({ tenantId }).catch(() => {
      // Best-effort — runner at root layout will retry on the next mount.
    });
  }, [isStandalone, a2hsStatus, recordA2hsAccepted, tenantId]);

  const visibility = decideIosBottomSheetVisibility({
    isIosSafari: isIos,
    isStandalone,
    a2hsStatus,
    dismissed,
  });

  if (visibility.kind === "hidden") return null;

  const onDismiss = (): void => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(A2HS_IOS_SHEET_DISMISS_KEY, "1");
      // setItem does NOT fire `storage` on the SAME document — dispatch a
      // synthetic event so useSyncExternalStore re-reads. Same trick as
      // <WalletPromptBanner> (#460).
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: A2HS_IOS_SHEET_DISMISS_KEY,
          newValue: "1",
        }),
      );
    } catch {
      // Privacy mode / quota — best-effort; the Drawer state below still
      // closes via Vaul's internal state.
    }
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DrawerContent data-testid="ios-install-bottom-sheet" className="px-0">
        <DrawerHeader>
          <DrawerTitle>Ajoute ce resto à ton écran d&apos;accueil</DrawerTitle>
          <DrawerDescription>
            1 tap pour retrouver ton resto la prochaine fois, sans passer par
            Safari.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <InstructionsIllustration />
          <p className="text-sm text-zinc-700">
            Dans Safari, touche l&apos;icône <ShareIconInline /> en bas de
            l&apos;écran, puis fais défiler et choisis{" "}
            <strong>Sur l&apos;écran d&apos;accueil</strong>, puis{" "}
            <strong>Ajouter</strong>.
          </p>
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              data-testid="ios-install-dismiss"
            >
              OK plus tard
            </button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG illustration — placeholder pattern matching #459 (HITL-3 Lottie
// assets pending). 3 steps with a pulse on the « Ajouter » CTA to mimic the
// 8s GIF loop the PRD references. Swap to GIF/Lottie via cosmetic PR once
// designer livre the asset.
// ---------------------------------------------------------------------------

function InstructionsIllustration(): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label="Instructions A2HS iOS : Safari → Partager → Sur l'écran d'accueil → Ajouter"
      data-testid="ios-install-instructions"
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
    >
      <Step
        index={1}
        label={
          <>
            Touche <strong>l&apos;icône Partager</strong>
          </>
        }
        icon={<ShareIconInline />}
      />
      <Step
        index={2}
        label={
          <>
            Choisis <strong>Sur l&apos;écran d&apos;accueil</strong>
          </>
        }
        icon={<HomeScreenIconInline />}
      />
      <Step
        index={3}
        label={
          <>
            Confirme avec <strong>Ajouter</strong>
          </>
        }
        icon={<PulseAddIconInline />}
      />
    </div>
  );
}

function Step({
  index,
  label,
  icon,
}: {
  index: number;
  label: React.ReactNode;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
        {index}
      </span>
      <span className="flex-1 text-sm text-zinc-700">{label}</span>
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
    </div>
  );
}

function ShareIconInline(): React.JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-emerald-700"
    >
      <path
        d="M12 3v12m0-12l-4 4m4-4l4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HomeScreenIconInline(): React.JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-emerald-700"
    >
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 7v10M7 12h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PulseAddIconInline(): React.JSX.Element {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      aria-hidden="true"
      className="text-emerald-700"
    >
      <circle cx="13" cy="13" r="11" fill="currentColor" opacity="0.15">
        <animate
          attributeName="r"
          values="9;12;9"
          dur="1.5s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="13" cy="13" r="7" fill="currentColor" />
      <path
        d="M13 9v8M9 13h8"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
