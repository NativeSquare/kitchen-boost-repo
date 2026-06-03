/**
 * Public API of the `printing` backend module (#412 KB Orders, PRD 20 §14 +
 * kb-orders CONTEXT « Impression thermique cuisine »).
 *
 * The module exposes the tenant printer config persistence — `getPrinterConfig`,
 * `setPrinterConfig`, `clearPrinterConfig`. The actual HTTP POST to the Star
 * Micronics WebPRNT endpoint happens CLIENT-SIDE in the native app (LAN-only
 * printer unreachable from Convex's cloud workers); the native helpers live
 * in `apps/native/src/lib/printing`.
 *
 * Convex registers functions by their module PATH so callers invoke them as
 * `api.lib.printing.printing.*`. The Star WebPRNT URL persists on
 * `tenants.printerConfig.starWebPrntUrl` — same field KB Admin (#416) writes
 * to, so a change on the web admin flips the kitchen tablet live through
 * the Convex sub (PRD 20 §14 « state Convex partagé »).
 *
 * Isolation (ADR 0010): every function goes through a tenancy wrapper and
 * reaches the table only through the sanctioned `lib/tenancy/tenantsStore`
 * seam — no raw `ctx.db` here. Ships a cross-tenant fuzz suite.
 *
 * The registered query / mutations are reached by their module path, so
 * they are NOT re-exported here (a barrel re-export would not change their
 * callable path) — this index file states the module's contract only.
 */
export {};
