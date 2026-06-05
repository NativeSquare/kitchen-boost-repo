/**
 * Pure decision: which top-level navigation shell to mount for KB Orders.
 *
 * Two variants:
 *
 *  - `drawer` — persistent left drawer (tablet kitchen kiosque, big phones in
 *    landscape, anything ≥ 768px). The drawer entries are wide enough to read
 *    at arm's length on the Lenovo Tab M8 (PRD 20 §12 « kiosque tablette »).
 *  - `tabs` — bottom tabs (KB Manager on the phone in mobility). Bottom tabs
 *    keep precious vertical real estate free on smaller screens.
 *
 * Decision rule (matches the story brief):
 *
 *  - `device.mode === "kiosque"` ALWAYS picks drawer (PRD 20 §12 — the kiosque
 *    posture is a tablet on the counter by convention, the drawer mirrors
 *    that posture even if the device width somehow reported < 768).
 *  - Otherwise, `width >= 768` picks drawer (large viewport = tablet).
 *  - Else `tabs` (phone, mobility).
 *
 * Threshold pinned at 768px (the Tailwind `md` breakpoint and the typical
 * « phone vs tablet » boundary on Android). Same threshold the home strip
 * components already use for their `sm:p-6` / `sm:px-6` paddings — keeps
 * the visual language coherent.
 */

/** Per-device mode resolved by `getMyDevice` (#393). */
export type DeviceMode = "kiosque" | "telephone";

/** Verdict — which shell `(tabs)/_layout.tsx` should mount. */
export type FormFactorShell = "drawer" | "tabs";

/** Width threshold (px) above which we consider the device a tablet. */
export const TABLET_MIN_WIDTH_PX = 768;

export type FormFactorInputs = {
  /** `useWindowDimensions().width`. */
  width: number;
  /**
   * `device.mode` from `getMyDevice` — `null` while the Convex query / device
   * row is still resolving. The decision degrades gracefully on `null` (falls
   * back to the width-only heuristic).
   */
  deviceMode: DeviceMode | null;
};

/**
 * Decide which top-level shell to mount. Pure — same inputs ⇒ same output.
 *
 * Defensive defaults : while `deviceMode` is loading (`null`), the verdict
 * relies purely on the viewport width — same heuristic as a fresh launch
 * on a tablet where the device row hasn't been read from SecureStore yet.
 * Kiosque mode ALWAYS wins to keep the cuisine posture stable even on the
 * (theoretical) edge case of a small-screen kiosque setup.
 */
export function decideFormFactorShell(
  inputs: FormFactorInputs,
): FormFactorShell {
  if (inputs.deviceMode === "kiosque") return "drawer";
  return inputs.width >= TABLET_MIN_WIDTH_PX ? "drawer" : "tabs";
}
