import { describe, expect, it } from "vitest";
import {
  ANOMALY_MAX_PER_48H,
  ANOMALY_MAX_PER_WEEK,
  ANOMALY_RECIPIENT_SURGE_RATIO,
  findCampaignAnomaly,
} from "./antiAnomaly";

/**
 * 2.7-D — the PURE per-resto anti-anomaly guard, written BEFORE the module (TDD
 * red). PRD 80 §7 (NOT invented):
 *  - frequency : > 1 campagne / 48h OR > 3 campagnes / semaine pour un MÊME resto
 *    → blocage auto + alerte.
 *  - recipient surge : bond destinataires +50 % vs l'envoi PRÉCÉDENT du resto →
 *    blocage auto.
 *
 * The rule is per-TENANT (the resto's own prior campaign launches), so the caller
 * passes the tenant's campaign history (launch timestamps + recipient counts) and
 * the about-to-send recipient count. Returns the FIRST violated rule, else null.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe("2.7-D anomaly thresholds are the PRD values", () => {
  it("max 1 campaign / 48h, max 3 / week, surge ratio 1.5 (+50%)", () => {
    expect(ANOMALY_MAX_PER_48H).toBe(1);
    expect(ANOMALY_MAX_PER_WEEK).toBe(3);
    expect(ANOMALY_RECIPIENT_SURGE_RATIO).toBe(1.5);
  });
});

describe("2.7-D findCampaignAnomaly — frequency 48h", () => {
  it("blocks a 2nd campaign within 48h (> 1 / 48h)", () => {
    const history = [{ launchedAt: NOW - 12 * HOUR, recipients: 100 }];
    expect(findCampaignAnomaly(history, 100, NOW)).toBe("TOO_FREQUENT_48H");
  });

  it("allows a campaign when the previous one is older than 48h", () => {
    const history = [{ launchedAt: NOW - 3 * DAY, recipients: 100 }];
    expect(findCampaignAnomaly(history, 100, NOW)).toBeNull();
  });
});

describe("2.7-D findCampaignAnomaly — frequency week", () => {
  it("blocks a 4th campaign within the week (> 3 / semaine)", () => {
    // 3 in the last week, none within 48h, recipients flat.
    const history = [
      { launchedAt: NOW - 3 * DAY, recipients: 100 },
      { launchedAt: NOW - 4 * DAY, recipients: 100 },
      { launchedAt: NOW - 5 * DAY, recipients: 100 },
    ];
    expect(findCampaignAnomaly(history, 100, NOW)).toBe("TOO_FREQUENT_WEEK");
  });

  it("allows when only 2 are in the week and none within 48h", () => {
    const history = [
      { launchedAt: NOW - 3 * DAY, recipients: 100 },
      { launchedAt: NOW - 5 * DAY, recipients: 100 },
    ];
    expect(findCampaignAnomaly(history, 100, NOW)).toBeNull();
  });
});

describe("2.7-D findCampaignAnomaly — recipient surge (+50% vs previous send)", () => {
  it("blocks when recipients jump > +50% vs the most recent previous send", () => {
    // previous (most recent) had 100 recipients; 151 is +51% ⇒ surge.
    const history = [{ launchedAt: NOW - 3 * DAY, recipients: 100 }];
    expect(findCampaignAnomaly(history, 151, NOW)).toBe("RECIPIENT_SURGE");
  });

  it("allows when recipients grow by exactly +50% (at the bound, not over)", () => {
    const history = [{ launchedAt: NOW - 3 * DAY, recipients: 100 }];
    expect(findCampaignAnomaly(history, 150, NOW)).toBeNull();
  });

  it("no surge check on the resto's very first campaign (no previous send)", () => {
    expect(findCampaignAnomaly([], 100000, NOW)).toBeNull();
  });

  it("compares against the MOST RECENT previous send, not an older one", () => {
    const history = [
      { launchedAt: NOW - 3 * DAY, recipients: 200 }, // most recent
      { launchedAt: NOW - 6 * DAY, recipients: 50 }, // older — ignored for surge
    ];
    // 250 vs most-recent 200 = +25% ⇒ allowed (would be a surge vs the older 50).
    expect(findCampaignAnomaly(history, 250, NOW)).toBeNull();
  });
});
