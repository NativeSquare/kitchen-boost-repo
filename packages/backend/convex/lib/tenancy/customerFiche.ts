import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.1-B — the SANCTIONED self-scoped data-access seam for the GLOBAL `customers`
 * fiche (the MOAT table, ADR 0010 documented exemption).
 *
 * The `customers` table carries NO `tenantId`, so it is reached through the
 * tenancy wrappers, never raw `ctx.db.query("customers")` in business code
 * (`no-untenanted-query`, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path — alongside the `customer*` wrappers it serves —
 * so it is the single sanctioned place raw `ctx.db` touches `customers` for the
 * SELF case. Business modules (`lib/customer/**`, NOT exempt) call THESE helpers
 * instead of `ctx.db`, exactly as they resolve identity through `getCurrentActor`
 * rather than `getAuthUserId` (ADR 0011).
 *
 * Both helpers are SELF-SCOPED by construction: they take the caller's own
 * `userId` (sourced from `ctx.actor.userId` in the wrapper handler) and key on
 * the `by_user` index — no other customer's fiche is reachable from here.
 */

/**
 * Read the caller's OWN `customers` fiche by `userId`, or `null` if none exists
 * yet. Keyed on the unique `by_user` index (one fiche per user, enforced
 * applicatively at provisioning).
 */
export async function readCustomerFicheByUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"customers"> | null> {
  return ctx.db
    .query("customers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Insert a fresh MINIMAL `customers` fiche for `userId` (silent provisioning,
 * ADR 0008): only `userId` + `createdAt`. Every captation field (email / phone /
 * firstName / address / lat / lng / consent / push) is filled later by the
 * checkout + push slices. Returns the new fiche id.
 */
export async function insertCustomerFiche(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"customers">> {
  return ctx.db.insert("customers", { userId, createdAt: Date.now() });
}

/**
 * Resolve the caller's OWN fiche, provisioning a minimal one if absent (silent
 * provisioning, ADR 0008). SELF-SCOPED by construction — keyed on `userId`
 * (sourced from `ctx.actor.userId`), so it can only ever touch the caller's own
 * fiche. Returns the existing or freshly-created fiche id. Used by the consent
 * mutations so a customer who never explicitly provisioned (e.g. opts out before
 * any checkout) still has a fiche to stamp.
 */
export async function getOrCreateCustomerFiche(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"customers">> {
  const existing = await readCustomerFicheByUser(ctx, userId);
  if (existing !== null) return existing._id;
  return insertCustomerFiche(ctx, userId);
}

/** The consent / opt-out fields a self-scoped mutation may stamp on a fiche. */
export type CustomerConsentPatch = {
  cgvAcceptedAt?: number;
  cgvVersionHash?: string;
  marketingOptOutDate?: number;
};

/**
 * Patch consent-related fields on a fiche the caller already resolved as its OWN
 * (the `customerId` MUST come from `getOrCreateCustomerFiche` / a self-scoped
 * read keyed on `ctx.actor.userId`). This is the single sanctioned `ctx.db.patch`
 * site for the GLOBAL `customers` table; business modules call it instead of
 * `ctx.db` (ADR 0010). The narrow patch type keeps it confined to the consent
 * surface — it cannot be repurposed to overwrite identity (`userId`) or personal
 * captation fields.
 */
export async function patchCustomerConsent(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  patch: CustomerConsentPatch,
): Promise<void> {
  await ctx.db.patch(customerId, patch);
}

/** The address-first fields the PWA captures via Google Places (PWA-S3 #451). */
export type CustomerAddressPatch = {
  address: string;
  lat: number;
  lng: number;
};

/**
 * PWA-S3 (#451) — stamp the Google-Places-normalised address (+ lat/lng) on a
 * fiche the caller already resolved as its OWN (the `customerId` MUST come from
 * `getOrCreateCustomerFiche` / a self-scoped read keyed on `ctx.actor.userId`).
 *
 * Re-submitting from the edit-after-validation UX (decisions-log Q7) OVERWRITES
 * the previous address; the fields are non-optional in the patch shape because
 * the form forbids free typing (Google Places suggestion required) so a
 * caller cannot smuggle a partial undefined / null patch through this seam.
 *
 * The single sanctioned `ctx.db.patch` site for these fields on the GLOBAL
 * `customers` table; the business module `lib/customer/address` (NOT exempt)
 * calls THIS instead of raw `ctx.db` (ADR 0010). The narrow patch type keeps it
 * confined to the address surface — it cannot overwrite identity (`userId`),
 * consent fields, the saved-card link, or `pushEnrollment`.
 */
export async function patchCustomerAddress(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  patch: CustomerAddressPatch,
): Promise<void> {
  await ctx.db.patch(customerId, patch);
}

/**
 * 2.5-D — stamp the saved-card link (the platform Stripe `Customer` + the
 * PaymentMethod saved on it) onto a fiche the caller already resolved as its OWN
 * (the `customerId` MUST come from a self-scoped read keyed on `ctx.actor.userId`).
 * The single sanctioned `ctx.db.patch` site for these fields on the GLOBAL
 * `customers` table; the business module `lib/stripe` (NOT exempt) calls THIS
 * instead of raw `ctx.db` (ADR 0010). `stripeCustomerId` is optional so a re-save
 * with the same platform Customer only updates the PaymentMethod. The narrow patch
 * type keeps it confined to the saved-card surface — it cannot overwrite identity
 * or captation fields.
 */
export async function setCustomerSavedCard(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  patch: { stripeCustomerId?: string; savedPaymentMethodId: string },
): Promise<void> {
  await ctx.db.patch(customerId, patch);
}

/**
 * 2.1-F — ROOT read of ANY `customers` fiche by id (support / RGPD, US #22). The
 * SELF helpers above key on `userId`; this one reads by document id and is reached
 * ONLY through the root `kbAdminQuery` wrapper (KB = responsable de traitement
 * RGPD, contrat Article 2 ter). Returns `null` if the fiche vanished. It NEVER
 * reaches a `kb_manager` — the resto sees only aggregates (the MOAT, ADR 0010).
 */
export async function readCustomerFicheById(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers">,
): Promise<Doc<"customers"> | null> {
  return ctx.db.get(customerId);
}

/**
 * 2.1-F — RGPD erasure by IRREVERSIBLE anonymisation (PRD 90 §6, customer-data
 * CONTEXT "Effacement RGPD = anonymisation irréversible", ADR 0012). The single
 * sanctioned `ctx.db.patch` site for the root erasure of the GLOBAL `customers`
 * table; the business module (`lib/customer/rgpd`, NOT exempt) calls THIS instead
 * of `ctx.db` (ADR 0010). It is reached only after the `kbAdminMutation` root gate
 * passed (KB = responsable de traitement, Article 2 ter).
 *
 * NULLIFIES — irreversibly, no backup copy — every personal field of the fiche:
 *  - PII captation: email / phone / firstName / address / lat / lng.
 *  - Push ENROLLMENT identity + reachability (the whole `pushEnrollment` object →
 *    walletSerialNumber, webPushSubscriptionId and per-channel statuses), since
 *    the Wallet serial is itself a cross-device identity bridge (ADR 0008/0012)
 *    and the reachability is PII-adjacent. Cleared in ONE geste (the object is
 *    modelled as a single optional field exactly for this — table customers.ts).
 *  - The saved-card link (`stripeCustomerId` / `savedPaymentMethodId`, 2.5-D): a
 *    Stripe Customer / PaymentMethod id is a payment IDENTITY of the person, not an
 *    accounting record (the accounting trace lives on the `payments` table via
 *    `paymentIntentId`), so it is nullified here — no dangling payment identity
 *    survives the erasure.
 *
 * PRESERVES — accounting (Code de commerce L123-22, 10 ans) + KPI resto:
 *  - `userId`, `createdAt`, `cgvAcceptedAt` / `cgvVersionHash` (CNIL consent
 *    proof), `marketingOptOutDate`, `lastCheckoutAt` are LEFT INTACT — none is
 *    personal data identifying the customer; they are kept for legal/audit. The
 *    fiche row is NOT hard-deleted (no hard delete V1).
 *  - `customerOrdersPerTenant` is a SEPARATE table this helper never touches, so
 *    the historical per-tenant stats (totalOrders / lastOrderAt / ltv) survive the
 *    anonymisation untouched.
 *
 * Stamps `anonymizedAt` (the irreversibility marker). Removing an optional field
 * is done by patching it to `undefined` (Convex deletes the field), so the fiche
 * keeps NO trace of the erased PII.
 */
export async function anonymizeCustomerFiche(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  at: number,
): Promise<void> {
  await ctx.db.patch(customerId, {
    email: undefined,
    phone: undefined,
    firstName: undefined,
    address: undefined,
    lat: undefined,
    lng: undefined,
    pushEnrollment: undefined,
    stripeCustomerId: undefined,
    savedPaymentMethodId: undefined,
    anonymizedAt: at,
  });
}
