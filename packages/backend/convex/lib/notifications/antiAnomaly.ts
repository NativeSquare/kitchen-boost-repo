/**
 * 2.7-D — the PURE per-resto anti-anomaly guard (PRD 80 §7 "Garde-fous
 * techniques"). NO Convex ctx — unit-testable in isolation.
 *
 * Two automatic blocking rules on a tenant's OWN campaign cadence (the caller
 * passes the resto's prior campaign LAUNCH history + the about-to-send recipient
 * count). NOT invented — verbatim from PRD 80 §7:
 *  - frequency  : > 1 campagne / 48h  OR  > 3 campagnes / semaine pour un MÊME
 *    resto → blocage auto + alerte.
 *  - recipient surge : bond inattendu de la base destinataires (+50 % vs l'envoi
 *    PRÉCÉDENT du même resto) → blocage auto.
 *
 * The caller turns a non-null reason into a Forbidden-style throw + a `logAudit`
 * anomaly row + the KB alert. The very first campaign of a resto (empty history)
 * trips no rule.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const H48_MS = 48 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Max campaigns allowed in a trailing 48h for one resto (PRD 80 §7: > 1 blocks). */
export const ANOMALY_MAX_PER_48H = 1;
/** Max campaigns allowed in a trailing week for one resto (PRD 80 §7: > 3 blocks). */
export const ANOMALY_MAX_PER_WEEK = 3;
/** Recipient surge ratio vs the previous send (PRD 80 §7: +50 % blocks). */
export const ANOMALY_RECIPIENT_SURGE_RATIO = 1.5;

/** One prior campaign launch of the resto (the anomaly history element). */
export type CampaignLaunchRecord = {
  launchedAt: number;
  recipients: number;
};

/** The first violated anomaly rule, or `null` when the launch is within bounds. */
export type CampaignAnomaly =
  | "TOO_FREQUENT_48H"
  | "TOO_FREQUENT_WEEK"
  | "RECIPIENT_SURGE";

/**
 * Detect the FIRST anomaly an about-to-send campaign would trip for this resto,
 * given its prior launches + the recipient count of the new send. Returns `null`
 * when nothing is violated. Deterministic order: 48h → week → recipient surge.
 */
export function findCampaignAnomaly(
  history: CampaignLaunchRecord[],
  recipients: number,
  now: number,
): CampaignAnomaly | null {
  // The about-to-send campaign counts towards the cadence, so we compare the
  // count INCLUDING it (`prior + 1`) against the PRD ceilings ("> 1 / 48h",
  // "> 3 / semaine") — i.e. a prior count already AT the ceiling blocks the next.
  const in48h = history.filter((h) => h.launchedAt > now - H48_MS).length;
  if (in48h + 1 > ANOMALY_MAX_PER_48H) return "TOO_FREQUENT_48H";

  const inWeek = history.filter((h) => h.launchedAt > now - WEEK_MS).length;
  if (inWeek + 1 > ANOMALY_MAX_PER_WEEK) return "TOO_FREQUENT_WEEK";

  // Recipient surge vs the MOST RECENT previous launch only (the resto's last
  // send). No previous send (first campaign) ⇒ no surge possible.
  const previous = mostRecent(history);
  if (previous !== null && previous.recipients > 0) {
    if (recipients > previous.recipients * ANOMALY_RECIPIENT_SURGE_RATIO) {
      return "RECIPIENT_SURGE";
    }
  }

  return null;
}

/** The launch with the greatest `launchedAt`, or null for an empty history. */
function mostRecent(
  history: CampaignLaunchRecord[],
): CampaignLaunchRecord | null {
  let best: CampaignLaunchRecord | null = null;
  for (const h of history) {
    if (best === null || h.launchedAt > best.launchedAt) best = h;
  }
  return best;
}
