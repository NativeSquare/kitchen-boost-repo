/**
 * PWA-S8 (#459) — `tracking` module API.
 *
 * The tracking page (`apps/web/src/app/c/[orderId]/page.tsx`) + the
 * `<TrackingView>` client component consume :
 *  - `decideTrackingSteps(input)` → ordered step list with done/current/pending.
 *  - `decideEtaLabel(input)`      → « ETA : 12 min » string or null.
 *  - `decideIncident(delivery)`   → « Incident livraison » card or null.
 *
 * The IO surface (Convex `useQuery`, navigation, `Date.now()` ticking)
 * is wired by the component itself — splitting "decide" from "perform"
 * lets vitest pin every branch in node env without DOM/Convex deps
 * (same shape as PWA-S1's tenant-resolver, PWA-S2's pwa-manifest,
 * PWA-S7's stripe-payment).
 */
export {
  decideTrackingSteps,
  type DecideTrackingStepsInput,
  type DeliveryStatus,
  type OrderStatus,
  type StepKey,
  type StepState,
  type TrackingStep,
} from "./decide-tracking-steps";
export { decideEtaLabel, type DecideEtaLabelInput } from "./decide-eta-label";
export {
  decideIncident,
  type DecideIncidentInput,
  type DeliveryIncidentType,
  type TrackingIncident,
} from "./decide-incident";
