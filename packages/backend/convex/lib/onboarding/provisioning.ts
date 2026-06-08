import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  attachUserToTenant,
  getProspect as getProspectRow,
  getTenantBySlug,
  getUserByEmail,
  insertManagerUser,
  insertTenant,
  kbAdminMutation,
  logAudit,
  setProspectTenant,
} from "../tenancy";

/**
 * 2.9-E — the tenant PROVISIONING WIZARD backend (PRD 70 §3.6, multi-tenant
 * CONTEXT "Provisioning", PRD 50 §2/§3). Orchestration ONLY — the multi-step UI
 * is front Train B. `provisionTenant` turns a prospect (that reached Préparation
 * via the Closing auto-bascule, slice C) into a live tenant:
 *
 *  1. validate a UNIQUE slug (a duplicate would collide on the bootstrap
 *     sub-domain `<slug>.kitchen-boost.com` — rejected);
 *  2. create the `tenants` row (`pending` lifecycle), stamping `customDomain`
 *     (public face, norm V1) when supplied;
 *  3. attach a KB Manager — REUSE an existing `users` row by email (cas Walid:
 *     one user, N tenants) or create a fresh one — via a `userTenants` link with
 *     resto role `kb_manager`;
 *  4. configure the tenant domain: `customDomain` is the PUBLIC FACE; the
 *     `<slug>.kitchen-boost.com` sub-domain is a BOOTSTRAP/fallback only, never the
 *     public face (PRD 50 §3, décision 2026-05-25);
 *  5. produce the QR data (the PWA URL the sticker encodes), resolving to the
 *     `customDomain` when set, with the bootstrap sub-domain as fallback ONLY —
 *     NOT hardcoded to the sub-domain;
 *  6. flag the Stripe `account_link` step (SOFT dependency on 2.5): the actual
 *     account-link creation is the 2.5 ACTION (`lib.stripe.account
 *     .createStripeAccountLink`, runs in the action runtime, reads
 *     `STRIPE_SECRET_KEY`) — a mutation can't call it. So here we only FEATURE-
 *     FLAG it (enabled iff `STRIPE_SECRET_KEY` is configured); when off, the rest
 *     of provisioning still completes (no hard failure). The front then triggers
 *     the action with the returned `tenantId`.
 *  7. back-link the originating prospect (`prospect.tenantId`).
 *
 * COHERENCE: the slug-uniqueness check happens FIRST, before any write. Inside a
 * Convex mutation every write commits in ONE transaction and a thrown error rolls
 * them ALL back — so a mid-way failure (e.g. a racing duplicate slug) can never
 * leave an orphaned tenant or a half-created KB Manager link.
 *
 * Root-only: runs through `kbAdminMutation` (kb_admin) — a `kb_manager` / `staff`
 * / `customer` is refused Forbidden (cross-tenant fuzz). Reaches the core tables
 * EXCLUSIVELY through the sanctioned `lib/tenancy/**` seams (tenantsStore /
 * usersStore / userTenantsStore / prospectsStore) — never raw `ctx.db` here
 * (`no-untenanted-query`, ADR 0010). Identity flows only via the wrapper's
 * `getCurrentActor` (ADR 0011). Auto-audited by `kbAdminMutation`, plus an
 * explicit richer `tenant.provision` row carrying the new tenant id.
 */

/** The KB base domain the bootstrap sub-domain is built on (kitchen-boost.com). */
const KB_BASE_DOMAIN = "kitchen-boost.com";

/**
 * PURE: a URL-friendly, unique-candidate slug from a free-text restaurant name
 * (multi-tenant CONTEXT "Slug": lower-case, `[a-z0-9-]+`, immutable). Strips
 * accents (NFD + combining-mark removal), lower-cases, replaces every run of
 * non-alphanumeric chars with a single hyphen, and trims edge hyphens. The caller
 * may pass its own slug; this is the default candidate the wizard proposes.
 */
export function generateSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * PURE: the tenant's PUBLIC PWA URL the QR sticker encodes (PRD 50 §3). Resolves
 * to the `customDomain` (public face, norm V1, modèle Owner.com) when set, with
 * the bootstrap `<slug>.kitchen-boost.com` sub-domain as fallback ONLY — never
 * hardcoded to the sub-domain when a custom domain exists.
 */
export function tenantPwaUrl(tenant: {
  slug: string;
  customDomain?: string;
}): string {
  const host = tenant.customDomain ?? `${tenant.slug}.${KB_BASE_DOMAIN}`;
  return `https://${host}`;
}

/** PURE: the always-generated bootstrap sub-domain URL (Day-1 / preview only). */
export function tenantBootstrapUrl(slug: string): string {
  return `https://${slug}.${KB_BASE_DOMAIN}`;
}

/** The Stripe account_link step state returned to the wizard front. */
type StripeOnboardingState = {
  /** Whether the 2.5 account_link step is available (STRIPE_SECRET_KEY set). */
  enabled: boolean;
};

/** The QR data the front renders into the printable sticker (@react-pdf is front). */
type QrData = {
  /** The PWA URL the QR encodes — the public face (customDomain) or bootstrap. */
  pwaUrl: string;
  /** The always-present bootstrap sub-domain URL (fallback / preview). */
  bootstrapUrl: string;
};

/** The provisioning result the wizard front consumes to finish the flow. */
type ProvisionResult = {
  tenantId: Id<"tenants">;
  slug: string;
  managerUserId: Id<"users">;
  qr: QrData;
  stripeOnboarding: StripeOnboardingState;
};

const conflict = (message: string) =>
  new ConvexError({ code: "CONFLICT", message });

/**
 * Provision a prospect into a live tenant (root-only, audited). Orchestration
 * only — see the module header. Atomic by virtue of the Convex single-transaction
 * mutation: the duplicate-slug guard runs before any write, and any later throw
 * rolls back every write (no orphaned tenant).
 */
export const provisionTenant = kbAdminMutation({
  args: {
    prospectId: v.id("prospects"),
    name: v.string(),
    siret: v.string(),
    slug: v.string(),
    customDomain: v.optional(v.string()),
    manager: v.object({
      email: v.string(),
      name: v.optional(v.string()),
    }),
  },
  // The wrapper auto-audits with this verb; the explicit richer row below uses
  // the canonical `tenant.provision` action (carrying the new tenant id +
  // metadata), mirroring `applyClosing`'s evaluate/autoBascule split.
  action: "tenant.provision.run",
  handler: async (ctx, args): Promise<ProvisionResult> => {
    // The originating prospect must exist (the wizard launches from its detail).
    const prospect = await getProspectRow(ctx, args.prospectId);
    if (prospect === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Prospect not found.",
      });
    }

    // 1. Unique slug FIRST, before any write — a duplicate would collide on the
    //    bootstrap sub-domain `<slug>.kitchen-boost.com` (PRD 50 §3, edge case
    //    "2 restos veulent le même slug" → refus).
    const slugTaken = await getTenantBySlug(ctx, args.slug);
    if (slugTaken !== null) {
      throw conflict(`Slug "${args.slug}" is already taken.`);
    }

    // 2. Create the tenant (pending lifecycle), customDomain = public face when set.
    const tenantId = await insertTenant(ctx, {
      slug: args.slug,
      name: args.name,
      siret: args.siret,
      customDomain: args.customDomain,
    });

    // 3. Attach a KB Manager — REUSE by email (cas Walid) or create. The resto
    //    role (`kb_manager`) lives on the userTenants link, never on users.role.
    const existing = await getUserByEmail(ctx, args.manager.email);
    const managerUserId =
      existing?._id ??
      (await insertManagerUser(ctx, {
        email: args.manager.email,
        name: args.manager.name,
      }));
    await attachUserToTenant(ctx, {
      userId: managerUserId,
      tenantId,
      role: "kb_manager",
      attachedBy: ctx.actor.userId,
    });

    // 4 + 5. Domain config + QR data: customDomain is the public face, bootstrap
    //         sub-domain is fallback only (NOT hardcoded to the sub-domain).
    const qr: QrData = {
      pwaUrl: tenantPwaUrl({
        slug: args.slug,
        customDomain: args.customDomain,
      }),
      bootstrapUrl: tenantBootstrapUrl(args.slug),
    };

    // 6. Stripe account_link: SOFT dependency on 2.5 — flag enabled iff the
    //    secret is configured. The actual link creation is the 2.5 action
    //    (createStripeAccountLink), which the front triggers with `tenantId`.
    const stripeOnboarding: StripeOnboardingState = {
      enabled: Boolean(process.env.STRIPE_SECRET_KEY),
    };

    // 7. Back-link the originating prospect to its new tenant.
    await setProspectTenant(ctx, args.prospectId, tenantId);

    // Explicit, richer audit row (on top of the wrapper's auto root-mutation log).
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: "tenant.provision",
      tenantId,
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        slug: args.slug,
        prospectId: args.prospectId,
        managerUserId,
        customDomain: args.customDomain,
        stripeEnabled: stripeOnboarding.enabled,
      },
    });

    return { tenantId, slug: args.slug, managerUserId, qr, stripeOnboarding };
  },
});
