"use client";

/**
 * FEATURE A (#closed-resto UX) — `<ServiceStatusProvider>`: the LIVE open/closed
 * source of truth for the PWA shop surfaces, driving the closed-resto sheet at
 * LOAD and feeding the disabled-Livraison tap decision (Feature B).
 *
 * Two reactivity sources, deliberately combined (issue spec A.5 stale-tab):
 *  1. Convex reactive subscription on `readServiceStatus({ tenantId })` — pushes
 *     DATA changes (an admin editing the hours propagates live).
 *  2. A client INTERVAL (~30s) re-evaluating `clientIsOpenNow(windows, now)`
 *     against the WALL CLOCK — because a natural closing at e.g. 22:00 crosses
 *     the clock without any data change, so Convex reactivity alone would NOT
 *     push it. The interval recomputes `isOpen` + the next-opening label from the
 *     SAME windows, so the sheet appears on a flip open→closed even mid-browse,
 *     and dismisses on a flip closed→open.
 *
 * The open/closed math is the PURE `lib/availability` core (unit-pinned). This
 * component owns ONLY the IO (subscription + interval + `Date.now()`).
 *
 * Exposes `isOpen` via context so `<DeliveryModeToggle>` can defer a
 * disabled-Livraison tap to the closed UX (Feature B `decideDisabledDeliveryTap`).
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
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  clientIsOpenNow,
  decideNextOpening,
  formatNextOpeningLabel,
  type ServiceWindow,
} from "@/lib/availability";

/** How often to re-evaluate the wall clock against the windows (stale-tab). */
const TICK_MS = 30_000;

type ServiceStatusContextValue = {
  /**
   * Live open/closed against the current clock. `null` while the windows query
   * is still loading (the toggle / sheet treat `null` as "not yet known" and do
   * not flash the closed UX before the first data arrives).
   */
  isOpen: boolean | null;
  /** The tenant's persisted windows (empty while loading or unconfigured). */
  windows: ServiceWindow[];
  /** FR réouverture label for the closed sheet (recomputed each tick). */
  nextOpeningLabel: string;
  /**
   * Monotonic counter the closed sheet watches: a disabled-Livraison tap while
   * the resto is closed (`decideDisabledDeliveryTap` → "closed-sheet") bumps it
   * to RE-OPEN the (possibly dismissed) closed sheet. The sheet re-renders when
   * this increments.
   */
  showClosedSheetNonce: number;
  /** Bump `showClosedSheetNonce` — defer a disabled tap to the closed UX. */
  requestShowClosedSheet: () => void;
};

const ServiceStatusCtx = createContext<ServiceStatusContextValue | null>(null);

export function ServiceStatusProvider({
  tenantId,
  children,
}: {
  tenantId: Id<"tenants">;
  children: ReactNode;
}): React.JSX.Element {
  // Convex reactive sub — re-fires when an admin edits the hours (DATA change).
  const status = useQuery(api.lib.delivery.quote.readServiceStatus, {
    tenantId,
  });
  const windows = useMemo<ServiceWindow[]>(
    () => status?.windows ?? [],
    [status],
  );

  // Wall-clock tick — recompute open/closed every TICK_MS so a natural closing
  // (no data change) still flips the UI. `now` is state so the recompute below
  // re-renders. Also re-evaluated immediately when `windows` change.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const isOpen = status === undefined ? null : clientIsOpenNow(windows, now);
  const nextOpeningLabel = formatNextOpeningLabel(
    decideNextOpening(windows, now),
    now,
  );

  const [showClosedSheetNonce, setShowClosedSheetNonce] = useState(0);
  const requestShowClosedSheet = useCallback(
    () => setShowClosedSheetNonce((n) => n + 1),
    [],
  );

  const value = useMemo<ServiceStatusContextValue>(
    () => ({
      isOpen,
      windows,
      nextOpeningLabel,
      showClosedSheetNonce,
      requestShowClosedSheet,
    }),
    [
      isOpen,
      windows,
      nextOpeningLabel,
      showClosedSheetNonce,
      requestShowClosedSheet,
    ],
  );

  return (
    <ServiceStatusCtx.Provider value={value}>
      {children}
    </ServiceStatusCtx.Provider>
  );
}

/** Hook accessor — throws when used outside the provider. */
export function useServiceStatus(): ServiceStatusContextValue {
  const ctx = useContext(ServiceStatusCtx);
  if (ctx === null) {
    throw new Error(
      "useServiceStatus() must be called inside <ServiceStatusProvider>",
    );
  }
  return ctx;
}
