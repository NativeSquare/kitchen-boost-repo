/**
 * Public API of the `form-factor` native module.
 *
 * Two surfaces:
 *  - `useFormFactorShell` — hook the `(tabs)/_layout.tsx` consumes to pick
 *    drawer (tablet kiosque) vs bottom-tabs (phone mobility). Composes
 *    `useWindowDimensions` + `getMyDevice` so the shell flips live on
 *    rotation OR on a mode rebascule (`device.mode` change).
 *  - `decideFormFactorShell` (+ types + constant `TABLET_MIN_WIDTH_PX`) —
 *    the PURE decision function. No React, no Expo, no Convex. Pinned by
 *    `decide-form-factor.test.ts`. Same split convention as the other
 *    native lib modules (`decideForceUpdate` #394, `decideTenantSwitcher`
 *    #399, `decideSettingsVisibility` #418).
 *
 * Why a dedicated module rather than inlining in `(tabs)/_layout.tsx` :
 * the verdict is consumed in TWO places — the layout itself (to pick the
 * navigator) AND any surface that wants to adapt copy / padding per
 * shell (e.g. drawer entry icons, drawer header). Centralising the
 * decision keeps the truth table in ONE place.
 */
export {
  TABLET_MIN_WIDTH_PX,
  decideFormFactorShell,
  type DeviceMode,
  type FormFactorInputs,
  type FormFactorShell,
} from "./decide-form-factor";
export { useFormFactorShell } from "./use-form-factor";
