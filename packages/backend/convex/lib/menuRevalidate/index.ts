/**
 * PWA-S4 (#452) — `menuRevalidate` module API.
 *
 * Internal action scheduled from `lib/menu/publication.publishMenu` that
 * POSTs the HMAC-signed `{ tenantId }` body to the Next.js
 * `/api/revalidate` route in `apps/web` (decisions-log Q2 « ISR +
 * on-demand revalidate au clic Publier »). The route validates the HMAC
 * and calls `revalidateTag(menu:<tenantId>)` — the menu PWA HTML cached
 * by Vercel is then refreshed on the next visit.
 *
 * Addressed by its module path: `internal.lib.menuRevalidate.revalidateMenuTag.revalidateMenuTag`.
 * The barrel does NOT need to re-export it (Convex registers by path), but
 * we keep the convention so module APIs are auditable in one place.
 */
export * as revalidateMenuTag from "./revalidateMenuTag";
