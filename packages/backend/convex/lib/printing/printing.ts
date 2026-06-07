import { ConvexError, v } from "convex/values";
import {
  type TenantRole,
  clearTenantPrinterConfig,
  getTenantPrinterConfig,
  setTenantPrinterConfig,
  tenantMutation,
  tenantQuery,
} from "../tenancy";

/**
 * #412 — Star Micronics WebPRNT printer config (PRD 20 §14 + kb-orders
 * CONTEXT « Impression thermique cuisine »).
 *
 * The backend slice is intentionally minimal. The Star printer lives on the
 * resto's LAN and is UNREACHABLE from Convex's cloud workers — the actual
 * HTTP POST to `http://<ip>/StarWebPRNT/SendMessage` happens CLIENT-SIDE in
 * the native app (auto-print on `acknowledge` + the « Réimprimer » button +
 * the « Tester l'impression » button in Settings). All this module owns is
 * the persistence of the URL on `tenants.printerConfig.starWebPrntUrl`:
 *
 *   - `getPrinterConfig`   — operational read (kb_manager + staff). The
 *                            kitchen tablet under audit monolithique V1 needs
 *                            to read the URL to fire the auto-print, even if
 *                            its actor is a `staff` member.
 *   - `setPrinterConfig`   — gérant action (kb_manager). Validates the URL is
 *                            non-empty and uses an http/https scheme — same
 *                            guard the native form runs upstream, so a bad
 *                            paste is rejected on both surfaces.
 *   - `clearPrinterConfig` — gérant action. Removes the printer (auto-print
 *                            becomes a clean no-op, PRD 20 §14 « si pas
 *                            configurée → no-op silencieux »).
 *
 * ── State Convex partagé (PRD 20 §14) ─────────────────────────────────────
 * The mutation is the SAME one KB Admin (#416) will call — both surfaces
 * write through `tenant.printerConfig.starWebPrntUrl`, so a change on the
 * web mirror flips the kitchen tablet live through the Convex sub. No
 * duplication, no V1-only short-circuit.
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────
 * Every function is a tenancy wrapper keyed on the explicit `tenantId`; the
 * store re-checks tenant ownership via `ctx.db.get` (the sanctioned exempt
 * path of `tenantsStore`). No raw `ctx.db` here (`no-untenanted-query`).
 * Identity only via `getCurrentActor` (ADR 0011). The set + clear are
 * audited (sensitive writes — they affect how the kitchen receives orders).
 * Ships a cross-tenant fuzz suite (`printing.test.ts`).
 */

/** Read allows operational staff (kitchen tablet under V1 monolithique). */
const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

/**
 * Validate the URL the gérant types in Settings (or pastes from the printer's
 * web UI). Same regex as `isValidStarWebPrntUrl` on the native side — keeping
 * the rule on BOTH surfaces means a request crafted outside the native form
 * still hits this server-side check.
 *
 * Accepts only the canonical Star WebPRNT shape:
 *   `http(s)://<host>[:<port>]/StarWebPRNT/SendMessage[/]`
 * Rejects:
 *   - empty / whitespace-only (would silently mean « no printer »);
 *   - a bare IP (`192.168.1.42` without scheme — common copy-paste mistake);
 *   - http URLs missing the canonical path (`http://invalid` — Star printers
 *     ALWAYS expose `/StarWebPRNT/SendMessage`, so any other path is wrong);
 *   - unsafe schemes (`javascript:`, `file:`, `data:`).
 *
 * The URL itself is NOT fetched here — the printer is on a private LAN
 * Convex cannot reach. The fetch happens client-side; this validation only
 * guards the persistence boundary so the kitchen tablet always pulls back
 * something it can POST to.
 */
function assertValidStarWebPrntUrl(input: string): void {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new ConvexError({
      code: "INVALID_PRINTER_URL",
      message:
        "L'adresse de l'imprimante est obligatoire (ex http://192.168.1.42/StarWebPRNT/SendMessage).",
    });
  }
  if (
    !/^https?:\/\/[^\s/]+(?::\d+)?\/StarWebPRNT\/SendMessage\/?$/i.test(trimmed)
  ) {
    throw new ConvexError({
      code: "INVALID_PRINTER_URL",
      message:
        "Adresse invalide. Format attendu : http://<ip>/StarWebPRNT/SendMessage (ex http://192.168.1.42/StarWebPRNT/SendMessage).",
    });
  }
}

/**
 * Read the Star WebPRNT URL configured on the calling tenant, or `null`. The
 * native auto-print at `acknowledge` calls this once via `useQuery` on the
 * detail screen + a `client.query` at fire-time so a stale sub never POSTs
 * to a removed printer.
 */
export const getPrinterConfig = tenantQuery(OPERATIONAL_ALLOW)({
  args: {},
  handler: async (ctx): Promise<{ starWebPrntUrl: string } | null> =>
    getTenantPrinterConfig(ctx, ctx.tenantId),
});

/**
 * Set the Star WebPRNT URL on the calling tenant. Gérant-only — same access
 * shape as `setOperationalPause` / `setExceptionalClosure`: the kitchen
 * staff reads the config to fire the auto-print but only the manager
 * configures the printer. Audited.
 */
export const setPrinterConfig = tenantMutation()({
  args: { starWebPrntUrl: v.string() },
  audit: true,
  action: "tenant.printerConfig.set",
  handler: async (ctx, args): Promise<void> => {
    assertValidStarWebPrntUrl(args.starWebPrntUrl);
    await setTenantPrinterConfig(ctx, ctx.tenantId, args.starWebPrntUrl.trim());
  },
});

/**
 * Clear the Star WebPRNT URL on the calling tenant. Gérant-only. After
 * this, `getPrinterConfig` returns `null` and the native auto-print is a
 * clean no-op (PRD 20 §14). Audited.
 */
export const clearPrinterConfig = tenantMutation()({
  args: {},
  audit: true,
  action: "tenant.printerConfig.clear",
  handler: async (ctx): Promise<void> => {
    await clearTenantPrinterConfig(ctx, ctx.tenantId);
  },
});
