/**
 * F-CAMPAGNES [5/7] (#228) — `classifySendError`, the PURE error classifier the
 * stateful `VariablesForm` shell uses to decide WHICH UX branch follows a
 * failed `sendTenantCampaign` mutation.
 *
 * Mirror of the backend `anomalyError` shape (`packages/backend/convex/lib/
 * notifications/campaigns.ts`, l. 105):
 *
 *   const anomalyError = (reason: string) =>
 *     new ConvexError({
 *       code: "CAMPAIGN_ANOMALY",
 *       message: `Campaign anomaly blocked: ${reason}`,
 *     });
 *
 * The anomaly reason (one of `TOO_FREQUENT_48H` / `TOO_FREQUENT_WEEK` /
 * `RECIPIENT_SURGE`, see `antiAnomaly.ts: CampaignAnomaly`) is encoded in the
 * MESSAGE SUFFIX after « blocked: ». The classifier parses it back so the
 * dialog can pick the right FR copy — a `null` reason falls back to a generic
 * FR fallback message.
 *
 * Every OTHER thrown value (network, TEMPLATE_BOUND_VIOLATION, unknown) lands
 * on the generic branch (the shell shows a toast + retry).
 *
 * Pure — no React, no Convex ctx, no I/O. Single source of truth shared by the
 * shell + the test.
 */

import { ConvexError } from "convex/values";

/**
 * The anomaly tag the backend computes (mirror of the backend type, kept
 * decoupled here so the front does not statically import a backend symbol just
 * for a string literal union). Adding a new reason backend-side is a one-edit
 * tap here too.
 */
export type CampaignAnomalyReason =
  | "TOO_FREQUENT_48H"
  | "TOO_FREQUENT_WEEK"
  | "RECIPIENT_SURGE";

const KNOWN_REASONS: readonly CampaignAnomalyReason[] = [
  "TOO_FREQUENT_48H",
  "TOO_FREQUENT_WEEK",
  "RECIPIENT_SURGE",
];

/**
 * The decision the shell consumes:
 *   - `anomaly`  → open the `CampaignAnomalyDialog` (with the parsed reason,
 *                  possibly null when the message suffix is missing).
 *   - `generic`  → toast + retry (network / unexpected backend error).
 */
export type ClassifiedSendError =
  | { kind: "anomaly"; reason: CampaignAnomalyReason | null }
  | { kind: "generic" };

const ANOMALY_PREFIX = "Campaign anomaly blocked: ";

/**
 * Parse the reason suffix out of the backend `ConvexError` message. Returns
 * one of the known `CampaignAnomalyReason` values, or `null` when the suffix
 * is missing / unrecognised (defensive — a future backend tweak that drops
 * the prefix should still surface as an anomaly, just with a fallback copy).
 */
function parseAnomalyReason(message: unknown): CampaignAnomalyReason | null {
  if (typeof message !== "string") return null;
  if (!message.startsWith(ANOMALY_PREFIX)) return null;
  const suffix = message.slice(ANOMALY_PREFIX.length).trim();
  return (KNOWN_REASONS as readonly string[]).includes(suffix)
    ? (suffix as CampaignAnomalyReason)
    : null;
}

export function classifySendError(error: unknown): ClassifiedSendError {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown; message?: unknown };
    if (data?.code === "CAMPAIGN_ANOMALY") {
      return { kind: "anomaly", reason: parseAnomalyReason(data.message) };
    }
  }
  return { kind: "generic" };
}
