"use client";

/**
 * F-SHELL-09 — root entry. Role-aware redirect under the (app) shell.
 *
 * Mounted under `(app)/layout.tsx` (`SessionLoader` + `SessionGuard`,
 * apps/admin/src/app/(app)/layout.tsx), so by the time this component
 * renders we are GUARANTEED that `session.status === "ready"` AND
 * (`isAdmin` || `tenants.length > 0`) — the no-tenant case is intercepted
 * upstream with `NoTenantEmptyState`. The redirect logic below therefore
 * only ever runs for a usable actor.
 *
 * Routing matrix (ADR 0014 §5 + issue #223) lives in `decideRootEntry`
 * — see `root-entry.decision.ts` for the full docblock and the test
 * matrix in `root-entry.decision.test.ts`. This file is the thin
 * `"use client"` adapter: read the session via `useSession`, read the
 * `kb_current_tenant` cookie via `document.cookie`, call the pure
 * decision, and `router.replace(href)`. The branching has zero presence
 * here so the React shell stays trivially correct as long as the pure
 * function is.
 *
 * Cookie source — `document.cookie` (client). The cookie was written on
 * the previous tenant entry by the `[tenantId]/layout.tsx` `allow` branch
 * using `formatTenantCookie` from `components/app/tenant-context.tsx`;
 * we read it back here with `parseTenantCookie` (the only sanctioned
 * parser, ADR 0014 §4 — the cookie name & serialisation live in ONE
 * place). On SSR there's no `document` — we pass `undefined` (which the
 * pure function treats as "no hint" and falls back to the first tenant);
 * the first client-side render then re-evaluates with the real cookie and
 * the redirect goes to the right URL. No flash because the page only
 * renders a spinner until the redirect fires.
 *
 * History — the previous version of this file hardcoded the matrix in a
 * `useEffect` (KB Admin → /monitoring, manager → /t/<first>/menu) and did
 * NOT honour the `kb_current_tenant` cookie at all, so a multi-tenant
 * manager always landed on their first resto regardless of where they had
 * left the previous session. F-SHELL-09 closes that gap by extracting
 * the decision to a pure function and wiring the cookie read.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/lib/session";
import { parseTenantCookie } from "@/components/app/tenant-context";
import { decideRootEntry } from "./root-entry.decision";

export default function RootHome() {
  const session = useSession();
  const router = useRouter();

  React.useEffect(() => {
    // `document` is client-only — guarded so a future SSR pass doesn't
    // throw; on the server we treat the cookie as absent and the manager
    // falls back to first-tenant (same shape as a fresh session).
    const cookieTenantId =
      typeof document !== "undefined"
        ? parseTenantCookie(document.cookie)
        : undefined;

    const decision = decideRootEntry({ session, cookieTenantId });
    if (decision.kind === "redirect") {
      router.replace(decision.href);
    }
    // `wait` → leave the spinner up; the next session state change
    // re-runs this effect and picks the redirect.
  }, [session, router]);

  // Brief spinner while the effect schedules the navigation. Matches the
  // visual the guard uses, so the user never sees a flash of empty content.
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
