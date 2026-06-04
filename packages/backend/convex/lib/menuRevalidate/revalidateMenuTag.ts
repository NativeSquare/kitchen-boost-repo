/**
 * PWA-S4 (#452) — `revalidateMenuTag` internal action that the
 * `publishMenu` mutation schedules (`ctx.scheduler.runAfter(0, …)`) to
 * invalidate the Next.js ISR `/menu` HTML for the published tenant
 * (decisions-log Q2 « ISR + on-demand revalidate au clic Publier »).
 *
 * Pattern: identical Convex↔Node internal channel as 2.7-C Web Push + 2.8-D
 * Wallet push — HMAC-SHA256 over `${timestamp}.${body}` keyed on
 * `MENU_REVALIDATE_HMAC_SECRET`. Signature travels in
 * `x-kb-timestamp` / `x-kb-signature` headers; the receiving Next route
 * (`apps/web/src/app/api/revalidate/route.ts`) verifies before calling
 * `revalidateTag(menu:<tenantId>)`.
 *
 * Failures are NON-FATAL: a revalidate POST that fails / times out must not
 * roll back `publishMenu` — the snapshot is the source of truth, ISR is a
 * cache optimisation. The action logs and returns `{ ok: false, reason }`;
 * the eater PWA will still see fresh data on the NEXT request that
 * naturally evicts the cache (Vercel ISR `revalidate: 60` baseline below).
 *
 * Misconfiguration in dev / CI (env unset) ⇒ `{ ok: false, reason:
 * "MISCONFIGURED" }` — silently no-op rather than blowing up `publishMenu`.
 */
import { ConvexError, v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { signInternalRequest } from "../wallet/internalAuth";

/** Read the shared secret server-side ONLY. Returns null when absent. */
function revalidateSecret(): string | null {
  const secret = process.env.MENU_REVALIDATE_HMAC_SECRET;
  if (secret === undefined || secret === "") return null;
  return secret;
}

/** Read the Next.js revalidate route URL server-side ONLY. */
function revalidateRouteUrl(): string | null {
  const url = process.env.MENU_REVALIDATE_ROUTE_URL;
  if (url === undefined || url === "") return null;
  return url;
}

export const revalidateMenuTag = internalAction({
  args: { tenantId: v.id("tenants") },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (_ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const secret = revalidateSecret();
    const url = revalidateRouteUrl();

    // Dev / CI without the env wired ⇒ silent no-op (NOT fatal — publishMenu
    // must still commit). The eater PWA will see fresh data at the next
    // natural ISR eviction (the page route uses a low baseline revalidate).
    if (secret === null || url === null) {
      return { ok: false, reason: "MISCONFIGURED" };
    }

    const body = JSON.stringify({ tenantId: args.tenantId });
    const signed = await signInternalRequest(secret, body);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kb-timestamp": signed.timestamp,
          "x-kb-signature": signed.signature,
        },
        body,
      });
      if (!res.ok) {
        // Non-2xx ⇒ the Next route refused. Log via thrown ConvexError so the
        // Convex deployment dashboard surfaces the failure, but return `ok:
        // false` so callers (publishMenu schedule) don't perceive a crash.
        return { ok: false, reason: `HTTP_${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      // Network / timeout — same NON-FATAL treatment as a non-2xx (publishMenu
      // already committed the snapshot, ISR cache is only an optimisation).
      const message =
        err instanceof ConvexError ? "CONVEX_ERROR" : "FETCH_ERROR";
      return { ok: false, reason: message };
    }
  },
});
