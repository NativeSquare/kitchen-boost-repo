/**
 * #410 — pure decision over the raw backend output of `quickStats`
 * (PRD 20 §9 « Stats rapides V1 »). Same split as `decidePauseControl`
 * (#406), `decideClosureControl` (#407) and `decideForceUpdate` (#394):
 * keep React, Convex, expo OUT so the truth table is pinned by a fast
 * deterministic vitest suite (node env, no jsdom).
 *
 * The host React component is a thin adapter that subscribes to
 * `api.lib.stats.quickStats.quickStats({ tenantId })` (the Convex sub IS the
 * real-time refresh, PRD 20 §9 « pas de refresh manuel ») and feeds the
 * result here. Verdicts:
 *
 *  - `loading` — Convex sub still resolving (`stats === undefined`). The host
 *    renders skeleton cards so we don't flash « 0 € » before data lands.
 *  - `ready`   — KPIs ready + comparison shape (see below).
 *
 * Comparison shape (PRD 20 §9 « delta absolu + pourcentage ») :
 *
 *  - `comparable` — both prev & curr are meaningful baselines (`prev > 0` OR
 *    both = 0). `direction` ∈ `up | down | flat` drives the badge color.
 *  - `noBaseline` — `prev = 0 && curr > 0`. No percent (would be +∞);
 *    we expose just the absolute delta and `direction: "up"` so the host
 *    can show « Nouvelle semaine » or similar copy.
 *
 * The decision is PURE: same inputs ⇒ same output, no `Date.now()`, no side
 * effects. CA values stay in cents — the host's `formatCents` formats them.
 */

/** Backend `quickStats` shape — cents + integers. Matches the Convex return. */
export type QuickStatsRaw = {
  caToday: number;
  ordersToday: number;
  caWeek: number;
  caPrevWeek: number;
};

/** Comparison direction → drives the badge color (vert / rouge / gris). */
export type ComparisonDirection = "up" | "down" | "flat";

export type Comparison =
  | {
      kind: "comparable";
      direction: ComparisonDirection;
      delta: number;
      percent: number;
    }
  | {
      kind: "noBaseline";
      direction: "up";
      delta: number;
    };

export type QuickStatsDecision =
  | { kind: "loading" }
  | {
      kind: "ready";
      caToday: number;
      ordersToday: number;
      caWeek: number;
      caPrevWeek: number;
      comparison: Comparison;
    };

/**
 * Decide what the home Stats rapides bloc renders this frame. `stats` is the
 * Convex `useQuery` result:
 *  - `undefined` → query still in flight (host shows skeletons) ;
 *  - resolved → 4 KPIs + the comparison verdict.
 *
 * The comparison handles the « prev = 0 » edge explicitly so we never divide
 * by zero — PRD 20 §9 « delta absolu + pourcentage » becomes « delta absolu
 * only » when the previous week had no realized CA (typically a new resto's
 * first full week of activity).
 */
export function decideQuickStats(
  stats: QuickStatsRaw | undefined,
): QuickStatsDecision {
  if (stats === undefined) {
    return { kind: "loading" };
  }
  const { caToday, ordersToday, caWeek, caPrevWeek } = stats;
  const delta = caWeek - caPrevWeek;

  let comparison: Comparison;
  if (caPrevWeek === 0) {
    if (caWeek === 0) {
      // Both empty → no real comparison, but we surface a `flat` so the badge
      // is the neutral gris rather than the green « nouvelle semaine » pill.
      comparison = {
        kind: "comparable",
        direction: "flat",
        delta: 0,
        percent: 0,
      };
    } else {
      comparison = {
        kind: "noBaseline",
        direction: "up",
        delta,
      };
    }
  } else {
    const percent = Math.round((delta / caPrevWeek) * 100);
    const direction: ComparisonDirection =
      delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    comparison = {
      kind: "comparable",
      direction,
      delta,
      percent,
    };
  }

  return {
    kind: "ready",
    caToday,
    ordersToday,
    caWeek,
    caPrevWeek,
    comparison,
  };
}

/**
 * Format a cents amount as fr-FR EUR (`12,34 €`). Used by the host cards.
 * Pure — same `try`/`catch` defensive pattern as `formatPauseEta` (#406)
 * for ancient runtimes where `Intl.NumberFormat` may throw.
 */
export function formatCentsEur(cents: number): string {
  const euros = cents / 100;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(euros);
  } catch {
    return `${euros.toFixed(2)} €`;
  }
}

/**
 * Format a signed percent for the comparison badge (`+12 %`, `-5 %`, `0 %`).
 * Pure. The host uses this for the `comparable` comparison only — the
 * `noBaseline` case is rendered as text (e.g. « Nouvelle semaine »).
 */
export function formatSignedPercent(percent: number): string {
  if (percent > 0) return `+${percent} %`;
  // `-` is already in the value; round-to-zero edge is just « 0 % ».
  return `${percent} %`;
}
