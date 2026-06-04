"use client";

/**
 * PWA-S10 (#462) — `<PWAInstallProvider>` — captures the Android Chrome
 * `beforeinstallprompt` event so the post-cart `<AndroidInstallButton>` can
 * trigger the native install sheet later (decisions-log Q4, US 56-57).
 *
 * Why a context (vs ad-hoc event listener inside the button):
 *  - The `beforeinstallprompt` event fires ONCE per page-load — early, often
 *    before the user has interacted with anything. If we mounted the listener
 *    on the button, the event would already have fired by then (button is
 *    cart-gated → mounts after the first add) and the prompt would be lost.
 *  - The button only renders post-cart on /menu + /panier; the context lives
 *    at the ROOT layout so it captures the event the very first paint, no
 *    matter where the user lands (home / menu / cart).
 *  - Capturing the event also requires `event.preventDefault()` — otherwise
 *    Chrome auto-shows its own install banner (mini-infobar), competing
 *    with our UX (Q4 « post-cart, pas au mount »).
 *
 * Also listens for `appinstalled` window event — fires when the PWA gets
 * installed via ANY path (our button OR the Chrome 3-dot menu OR an OS
 * intent). We surface a callback so the button can fire the
 * `customer.pushEnrollment.recordA2hsAccepted` mutation in that case too
 * (AC « event appinstalled détecté → flip enrolled »).
 *
 * SSR: the provider returns its children unchanged when `window` is
 * undefined; React only calls the effects on the client. No hydration
 * mismatch (the captured prompt is purely a runtime concern — the SSR
 * snapshot ALWAYS pins `prompt = null`, matching the first client paint).
 *
 * iOS Safari: never fires `beforeinstallprompt` → `prompt` stays `null` →
 * the button never renders (AC 5 « iOS → bouton n'apparaît jamais »).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * The shape of the `beforeinstallprompt` event we care about (subset of the
 * BeforeInstallPromptEvent interface). Typescript DOM lib doesn't expose
 * `BeforeInstallPromptEvent` (still spec-experimental) — we type the minimum
 * surface here so the context contract is explicit.
 */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type PWAInstallContextValue = {
  /**
   * The captured `beforeinstallprompt` event, or `null` if none was captured
   * (iOS Safari, desktop, already-installed, prompt already consumed).
   * Read by `<AndroidInstallButton>` to decide whether to render + to call
   * `.prompt()` on user click.
   */
  prompt: BeforeInstallPromptEvent | null;
  /**
   * Clears the captured prompt. Called by the button right after
   * `.prompt()` resolves (the event is single-use — the spec forbids
   * re-calling `.prompt()` on a consumed event). Subsequent renders
   * therefore hide the button (no prompt → `decideA2hsButtonVisibility`
   * returns `hidden / no-prompt-captured`).
   */
  clearPrompt: () => void;
  /**
   * `true` once the `appinstalled` window event fires (any install path —
   * our button OR the browser menu). The button uses this as a SECONDARY
   * trigger to fire the `recordA2hsAccepted` mutation (covers the
   * « installed via Chrome menu » path that bypasses our button).
   * One-way: never flips back to false within a session.
   */
  installed: boolean;
};

const Ctx = createContext<PWAInstallContextValue | null>(null);

export function PWAInstallProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeInstallPrompt = (event: Event): void => {
      // Stop Chrome's own mini-infobar so OUR cart-gated button is the only
      // install surface (decisions-log Q4: « post-cart, pas au mount »).
      event.preventDefault();
      // Stash the event — the button consumes it later on click.
      setPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = (): void => {
      // Fires when the PWA is installed via ANY path. We surface this so
      // the button can fire the backend mutation even when the user took
      // a non-button install path (Chrome 3-dot menu, OS intent).
      setInstalled(true);
      // The prompt is also consumed when the install completes; clear it
      // proactively so the button hides immediately.
      setPrompt(null);
    };

    window.addEventListener(
      "beforeinstallprompt",
      onBeforeInstallPrompt as EventListener,
    );
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        onBeforeInstallPrompt as EventListener,
      );
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const clearPrompt = useCallback(() => {
    setPrompt(null);
  }, []);

  // `useMemo` keeps the context value referentially stable across renders
  // when neither `prompt` nor `installed` changed — children that consume
  // the context don't re-render needlessly.
  const value = useMemo<PWAInstallContextValue>(
    () => ({ prompt, clearPrompt, installed }),
    [prompt, clearPrompt, installed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Hook accessor. Throws when called outside the provider — same shape as
 * `useCart()` / `useDeliveryMode()`; surfaces a wiring bug loudly rather
 * than silently no-op'ing.
 */
export function usePWAInstall(): PWAInstallContextValue {
  const ctx = useContext(Ctx);
  if (ctx === null) {
    throw new Error(
      "usePWAInstall() must be called inside <PWAInstallProvider>",
    );
  }
  return ctx;
}
