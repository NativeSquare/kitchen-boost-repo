import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";

/**
 * 2.2-A — `serviceHours` ([[Plage horaire de service]]) (delivery CONTEXT
 * "Plage horaire de service", PRD 10 §4/§edge "resto fermé", PRD 40 §1bis, ADR
 * 0010). OWNED by this chantier.
 *
 * The windows during which the resto accepts orders. KB is the SOURCE OF TRUTH
 * (Uber Direct is backup only — it refuses the quote if the resto forgot to sync
 * its Uber hours). Configured in onboarding Phase C from KB Admin, editable
 * anytime. Read by the checkout: out-of-window ⇒ checkout BLOCKED ("Fermé, ouvre
 * à 18h30"); no pre-ordering in V1.
 *
 * V1 = a SINGLE shared slot for BOTH delivery AND click & collect (Q40-Q acté
 * 2026-05-24) — separate delivery vs C&C hours is V2. Modelled as ONE row per
 * tenant carrying the full list of open `windows` (rather than one row per
 * window): the schedule is small, always read as a whole, and a single embedded
 * list keeps a tenant's hours atomic to read/replace. Timezone is implicit
 * `Europe/Paris` (V1 is FR-only) — no per-window tz field.
 *
 * Each window is `{ dayOfWeek (0=Sun..6=Sat), startMinute, endMinute }` in
 * minutes-from-midnight, so BB's "11h30–14h30 + 18h30–22h30" is two windows per
 * open day. (Cross-midnight windows would be split into two on a later slice;
 * V1 service hours don't span midnight.)
 *
 * TENANT-SCOPED (carries `tenantId`, ADR 0010): read/written through the tenancy
 * wrappers, `no-untenanted-query` applies, ships cross-tenant fuzz coverage.
 * Indexed `by_tenant` (one row per tenant — uniqueness enforced applicatively).
 */

/**
 * One open window. `dayOfWeek`: 0 = Sunday … 6 = Saturday (JS `Date.getDay()`).
 * `startMinute` / `endMinute`: minutes from local midnight (0–1440),
 * `start < end`. The validators are the source of truth reused by later slices.
 */
export const serviceWindow = v.object({
  dayOfWeek: v.number(), // 0=Sun … 6=Sat
  startMinute: v.number(), // minutes from midnight, Europe/Paris
  endMinute: v.number(),
});

export type ServiceWindow = Infer<typeof serviceWindow>;

export const serviceHours = defineTable({
  tenantId: v.id("tenants"),
  windows: v.array(serviceWindow),
  updatedAt: v.number(),
}).index("by_tenant", ["tenantId"]);
