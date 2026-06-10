/**
 * PWA-S8 (#459) — `decideIncident` — pure decision returning whether the
 * tracking page should render the « Incident livraison, tu as été
 * remboursé » card (PRD 10 §11 « Cas incident », US 54, decisions-log Q7).
 *
 * Closed-set behaviour mirroring PRD 40 §5 :
 *  - `refused_post_payment`   → auto-refunded by 2.5 (#49)         → card visible
 *  - `incident_after_pickup`  → auto-refunded by 2.5 (#49)         → card visible
 *  - `customer_absent`        → resto-discretionary geste co.      → SILENT here
 *                               (Cas D, PRD 40 §5 — the resto MAY trigger a
 *                               manual refund from KB Orders ; we never auto-
 *                               display a « Tu as été remboursé » that may
 *                               turn out to be false)
 *  - undefined                → no incident                       → null
 *
 * The actual REFUND execution is owned elsewhere (2.5 #49, ADR 0019). This
 * decision is purely the front-side visibility rule.
 */
export type DeliveryIncidentType =
  | "refused_post_payment"
  | "incident_after_pickup"
  | "customer_absent";

/** Minimal shape — only the field the decision reads. */
export type DecideIncidentInput = {
  incidentType: DeliveryIncidentType | undefined;
} | null;

/** The card the React surface should render, or `null` to render nothing. */
export type TrackingIncident = {
  kind: "auto-refunded";
  title: string;
  message: string;
};

/** Decide whether to show the incident card and what it says. */
export function decideIncident(
  delivery: DecideIncidentInput,
): TrackingIncident | null {
  if (delivery === null) return null;
  const type = delivery.incidentType;
  if (type === undefined) return null;
  if (type === "customer_absent") return null;

  // refused_post_payment OR incident_after_pickup ⇒ auto-refunded card.
  return {
    kind: "auto-refunded",
    title: "Incident livraison",
    message:
      "Ta commande n'a pas pu être livrée. Tu as été remboursé automatiquement.",
  };
}
