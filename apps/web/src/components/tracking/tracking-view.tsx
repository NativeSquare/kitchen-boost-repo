"use client";

/**
 * PWA-S8 (#459) — `<TrackingView>` — the client surface of `/c/[orderId]`
 * (PRD §10 PWA Client §11 « Page Tracking », US 50 → 55, decisions-log Q7).
 *
 * Owns the IO the RSC `app/c/[orderId]/page.tsx` deliberately keeps out :
 *  - Convex subscription `getOrderTracking({tenantId, orderId})` — every
 *    backend write (workflow `recordStatus`, `confirmPayment`, the Uber
 *    webhook applier) triggers a Convex push and re-runs the pure step
 *    mapper → re-render < 500ms (acceptance criterion #459 « Webhook Uber
 *    Direct simulé → UI re-render <500ms »). No polling, no setInterval
 *    for the order/delivery state itself (decisions-log Q7).
 *  - A separate 30s `setInterval` ticking `Date.now()` for the ETA label
 *    only — the wall-clock delta « ETA : 12 min » needs to decrement
 *    independently of any backend write so the user sees the counter
 *    progress between webhook frames. Mirrors Uber's own ~30s ETA
 *    refresh cadence (PRD 10 §11).
 *  - The collapsible items recap via native `<details>` / `<summary>`
 *    (US 53 — « pas de lib »).
 *  - The incident card (US 54) when the delivery row carries
 *    `incidentType ∈ {refused_post_payment, incident_after_pickup}`
 *    (auto-refunded by 2.5 #49 — the UI surfaces the news, the refund
 *    execution is owned upstream).
 *
 * The PURE decisions live in `lib/tracking/*` (decideTrackingSteps /
 * decideEtaLabel / decideIncident) — vitest pins every branch in node env.
 * Splitting "decide" from "perform" is the project pattern (mirrors
 * lib/checkout-gate, lib/stripe-payment, lib/menu-filters).
 *
 * Placeholders SVG : HITL-3 (Lottie assets) is NOT blocking (cf. issue
 * #459 body) — V1 ships simple SVG circles + check-marks with CSS
 * transitions ; the Lottie swap is a separate cosmetic PR.
 */
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  decideEtaLabel,
  decideIncident,
  decideTrackingSteps,
  type DeliveryStatus,
  type OrderStatus,
  type TrackingStep,
} from "@/lib/tracking";

/** FR currency formatter — same shape used by `<CartView>` / `<CheckoutForm>`. */
function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export type TrackingViewProps = {
  tenantId: Id<"tenants">;
  orderId: Id<"orders">;
  restoName: string;
};

export function TrackingView({
  tenantId,
  orderId,
  restoName,
}: TrackingViewProps): React.JSX.Element {
  // The Convex subscription. `undefined` while loading; `null` if the order
  // is not found / cross-tenant (publicTenantQuery returns null indistinctly
  // — same as the resto-side `getOrder`).
  const tracking = useQuery(api.lib.orders.tracking.getOrderTracking, {
    tenantId,
    orderId,
  });

  // `Date.now()` ticking for the ETA label. The order/delivery state itself
  // is updated via the Convex push (no polling) ; only the « X min »
  // counter needs to keep counting between webhook frames. 30s cadence
  // matches Uber's own ETA refresh (PRD 10 §11).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (tracking === undefined) {
    // Loading — render a skeleton with the SAME shell as the live state so
    // the layout doesn't shift when the data lands.
    return <TrackingSkeleton />;
  }

  if (tracking === null) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-8 text-center">
        <p className="text-base text-zinc-600">
          Commande introuvable. Vérifie le lien ou contacte le resto.
        </p>
      </section>
    );
  }

  const steps = decideTrackingSteps({
    mode: tracking.mode,
    orderStatus: tracking.status as OrderStatus,
    deliveryStatus: (tracking.delivery?.status ??
      null) as DeliveryStatus | null,
  });

  const etaLabel = decideEtaLabel({
    mode: tracking.mode,
    deliveryStatus: (tracking.delivery?.status ??
      null) as DeliveryStatus | null,
    pickupEta: tracking.delivery?.pickupEta,
    dropoffEta: tracking.delivery?.dropoffEta,
    nowMs,
  });

  const incident = decideIncident(
    tracking.delivery === null
      ? null
      : { incidentType: tracking.delivery.incidentType },
  );

  return (
    <section className="flex flex-col gap-6">
      {/* Incident card — shown ABOVE the timeline when an auto-refund happened.
          The order's terminal state (refusée / failed) is reflected in the
          steps below for context. */}
      {incident !== null ? (
        <div
          role="alert"
          data-incident={incident.kind}
          className="flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-4"
        >
          <div className="flex items-center gap-3">
            <IncidentSvg />
            <h2 className="text-base font-semibold text-red-900">
              {incident.title}
            </h2>
          </div>
          <p className="text-sm text-red-900">{incident.message}</p>
        </div>
      ) : null}

      {/* Live timeline — 6 étapes delivery / 3 étapes C&C. */}
      <ol
        data-mode={tracking.mode}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4"
      >
        {steps.map((step) => (
          <li
            key={step.key}
            data-step-key={step.key}
            data-step-state={step.state}
            className="flex items-center gap-3"
          >
            <StepIcon state={step.state} />
            <span
              className={
                step.state === "current"
                  ? "text-base font-semibold text-emerald-800"
                  : step.state === "done"
                    ? "text-base text-zinc-700"
                    : "text-base text-zinc-400"
              }
            >
              {step.label}
            </span>
            {step.state === "current" && etaLabel !== null ? (
              <span className="ml-auto text-sm font-medium text-emerald-700">
                {etaLabel}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {/* Items recap — collapsible via NATIVE `<details>` (US 53, « pas de lib »). */}
      <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-zinc-700">
          Voir le détail de ma commande
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <ul className="flex flex-col gap-2 text-sm text-zinc-700">
            {tracking.items.map((item, idx) => (
              <li key={idx} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {item.itemName} × {item.quantity}
                  </span>
                  <span className="text-zinc-700">
                    {formatEur(item.unitPrice * item.quantity)}
                  </span>
                </div>
                {item.modifiers.length > 0 ? (
                  <ul className="ml-3 list-disc text-xs text-zinc-600">
                    {item.modifiers.map((mod, mIdx) => (
                      <li key={mIdx}>
                        {mod.groupName}: {mod.optionName}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {tracking.address !== null ? (
            <p className="text-xs text-zinc-600">
              <strong className="text-zinc-700">Adresse :</strong>{" "}
              {tracking.address}
            </p>
          ) : null}
          {tracking.totalCentimes !== null ? (
            <p className="text-sm font-semibold text-zinc-900">
              Total :{" "}
              <span className="text-zinc-900">
                {formatEur(tracking.totalCentimes)}
              </span>
            </p>
          ) : null}
        </div>
      </details>

      {/* Reassuring footer — first-visit eaters need to know an email also
          went out (PRD 10 §11 « Email transactionnel envoyé en parallèle »). */}
      <p className="text-xs text-zinc-500">
        Un email récapitulatif t&apos;a été envoyé. Tu peux fermer cette page et
        y revenir à tout moment via le lien dans l&apos;email — la commande de{" "}
        {restoName} continuera d&apos;avancer en temps réel.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Visual primitives — placeholders SVG (HITL-3 Lottie assets pending, cf.
// issue #459 body « placeholders SVG simples utilisés en attendant »).
// ---------------------------------------------------------------------------

function StepIcon({
  state,
}: {
  state: TrackingStep["state"];
}): React.JSX.Element {
  if (state === "done") {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="shrink-0 text-emerald-700"
      >
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path
          d="M7 12.5l3 3 7-7"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }
  if (state === "current") {
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="shrink-0 text-emerald-700"
      >
        <circle
          cx="12"
          cy="12"
          r="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="12" cy="12" r="5" fill="currentColor">
          <animate
            attributeName="r"
            values="4;6;4"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    );
  }
  // pending
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0 text-zinc-300"
    >
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function IncidentSvg(): React.JSX.Element {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0 text-red-700"
    >
      <circle cx="16" cy="16" r="14" fill="currentColor" />
      <path d="M16 8v9" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="22" r="1.8" fill="white" />
    </svg>
  );
}

function TrackingSkeleton(): React.JSX.Element {
  return (
    <section className="flex flex-col gap-6">
      <div
        data-loading="true"
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-6 w-6 animate-pulse rounded-full bg-zinc-200" />
            <div className="h-4 w-40 animate-pulse rounded bg-zinc-200" />
          </div>
        ))}
      </div>
    </section>
  );
}
