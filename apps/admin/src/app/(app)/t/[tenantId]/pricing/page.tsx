"use client";

/**
 * F-PRICING-1 (#241) — Route `/t/[tenantId]/pricing` (read-only liste).
 *
 * First tracer-bullet of EPIC F-PRICING (#146). The page is a thin wiring
 * layer: it reads `api.lib.pricing.rules.list` through `useTenantQuery`
 * (which auto-injects the current `tenantId` from `<TenantProvider/>`,
 * mounted by the chrome-less `/t/[tenantId]` layout — ADR 0014 §4 / #183)
 * and hands the result to `PricingView`.
 *
 * No CRUD here — slices 2-5 will add create / update / toggle / delete. No
 * `evaluate` import either: the engine is backend-only (ADR 0013) and the
 * list page never needs to compute a price. Both bans are pinned by
 * `page.test.ts` + `guardrails.test.ts`.
 *
 * Scope discipline (#241 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/pricing/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantQuery } from "@/hooks";

import { PricingView } from "./pricing-view";

export default function PricingPage() {
  const rules = useTenantQuery(api.lib.pricing.rules.list);
  return <PricingView rules={rules} />;
}
