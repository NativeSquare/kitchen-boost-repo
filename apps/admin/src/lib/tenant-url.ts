/**
 * F-QR.1 — PURE front-side mirror of the backend `tenantPwaUrl` helper
 * (`packages/backend/convex/lib/onboarding/provisioning.ts`). Same semantics:
 * if a `customDomain` is set (public face, modèle Owner.com), it wins;
 * otherwise we fall back to the bootstrap sub-domain
 * `<slug>.kitchen-boost.com` (Day-1 / preview only — PRD 50 §3).
 *
 * Kept duplicated front/back on purpose V1: 5 lines, no shared package, zero
 * runtime dep. If a third surface ever needs it (apps/web, …), extract to a
 * shared `@packages/shared` lib then. Until then, the tests pin the parity.
 */

/** The KB base domain the bootstrap sub-domain is built on (kitchen-boost.com). */
const KB_BASE_DOMAIN = "kitchen-boost.com";

/**
 * The tenant's PUBLIC PWA URL the QR sticker encodes. Resolves to
 * `https://<customDomain>` when set, otherwise to
 * `https://<slug>.kitchen-boost.com`.
 */
export function tenantPwaUrl(tenant: {
  slug: string;
  customDomain?: string;
}): string {
  const host = tenant.customDomain ?? `${tenant.slug}.${KB_BASE_DOMAIN}`;
  return `https://${host}`;
}
