import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  deleteAdminInvite,
  getActiveUserTenant,
  getLatestManagerInviteForTenant as readLatestManagerInviteForTenant,
  getManagerInviteForTenant,
  getTenantById,
  getUserByEmail,
  hasPasswordAccount,
  insertManagerInvite,
  kbAdminMutation,
  kbAdminQuery,
} from "../tenancy";

/**
 * B-AUTH-4 (#204, EPIC #134) — `inviteManager(tenantId, email, name?)`, the
 * root-only manager pendant of `inviteAdmin` (`convex/table/admin.ts` lignes
 * 169-232). PRD 50 §1.1 / multi-tenant CONTEXT D7 (gérant magic-link).
 *
 * Wrapper: `kbAdminMutation({ action: "manager.invite" })`. V1 strict: only the
 * KB Admin (root) can invite a gérant on any tenant — a `kb_manager` / `staff`
 * / `customer` is refused FORBIDDEN by the wrapper. The wrapper auto-audits.
 * Identity flows only via `getCurrentActor` (ADR 0011) — no direct
 * `getAuthUserId` call here (forbidden outside the sanctioned auth point).
 *
 * Tenancy discipline (ADR 0010): no raw `ctx.db` in this business module
 * (`no-untenanted-query` enforces it). Persistence goes through the sanctioned
 * `lib/tenancy/adminInvitesStore` seam; the existence checks reuse the
 * pre-existing seams (`tenantsStore`, `usersStore`, `userTenantsStore`,
 * `adminInvitesStore`).
 *
 * Validation pipeline (each rejection is a `ConvexError({ code, message })`):
 *  - `NOT_FOUND`        — `tenantId` does not resolve to a tenants row;
 *  - `ALREADY_MEMBER`   — an existing user with this email already has an
 *                         ACTIVE `userTenants` row (`detachedAt === undefined`)
 *                         on this tenant AND has actually completed sign-up
 *                         (a `password` `authAccounts` row exists for them) —
 *                         already gérant with a working account, no need for
 *                         another magic-link. A DETACHED attachment does NOT
 *                         block (re-invite OK). An ACTIVE attachment with NO
 *                         `password` authAccount does NOT block either: that
 *                         is the wizard-step-1-then-step-7 case where
 *                         `provisionTenant` stamped the `users` row + the
 *                         `userTenants` link from `prospect.email` BEFORE the
 *                         gérant has ever signed up — step 7 must send them
 *                         the first magic-link or they cannot loginner;
 *  - `ALREADY_INVITED`  — a pending non-expired invite for `(email, tenantId)`
 *                         already exists — no spam magic-link;
 *  - else if an EXPIRED invite exists for `(email, tenantId)`, delete it and
 *    create a fresh one (relance — admin can re-invite a gérant who never
 *    clicked within 7 days).
 *
 * Insert: `targetRole: "kb_manager"`, `tenantId`, `email`, `name`
 * (default = email prefix), `token` (32-char alphanum, same shape as
 * `inviteAdmin`), `invitedBy = actor.userId`, `expiresAt = now + 7d`. No
 * `acceptedAt`. The same email may be invited on N DIFFERENT tenants in
 * parallel (cas Walid Thai Street — the `by_email_tenant` index is the key).
 *
 * B-AUTH-5 wires the magic-link email: after the row is inserted, this
 * mutation schedules `internal.emails.sendManagerInviteEmail` with the
 * recipient (`to`), display `name` (resolved from `args.name` or the email
 * prefix), the freshly-minted `token`, and a `tenantName` SNAPSHOT read from
 * the `tenants` doc already loaded at step 1 (acceptance criterion: a later
 * tenant rename does NOT mutate emails already sent — the snapshot semantic is
 * intentional). The link in the email points at the same
 * `${SITE_URL}/accept-invite?token=…` endpoint as admin invites — the
 * `acceptInvite` mutation extended in B-AUTH-6 discriminates the two flows by
 * reading the invite row's `targetRole`. Scheduling via `runAfter(0, …)` keeps
 * the mutation transactional: a thrown error AFTER the schedule call rolls
 * the scheduled job back along with the insert.
 *
 * Convex registers this by module PATH, so callers invoke
 * `api.lib.admin.managerInvites.inviteManager`.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a 32-char alphanumeric token (same shape as `inviteAdmin` in
 * `convex/table/admin.ts`). Crypto-strength is not required: the token's only
 * job is to look up the invite by the magic-link URL it is embedded in
 * (B-AUTH-6 consumes it); the spam guards above are what stop abuse.
 */
function generateToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/** Derive the default display name from the email (everything before the @). */
function defaultNameFromEmail(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export const inviteManager = kbAdminMutation({
  args: {
    tenantId: v.id("tenants"),
    email: v.string(),
    name: v.optional(v.string()),
  },
  action: "manager.invite",
  handler: async (ctx, args): Promise<Id<"adminInvites">> => {
    // 1. The tenant must exist (NOT_FOUND surfaces a stale / mistyped id).
    const tenant = await getTenantById(ctx, args.tenantId);
    if (tenant === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Tenant not found.",
      });
    }

    // 2. ALREADY_MEMBER guard — refuse if a user with this email is already an
    //    ACTIVE member of this tenant AND has actually completed sign-up
    //    (a `password` `authAccounts` row exists for them). A soft-detached
    //    attachment does NOT block (ex-gérant must be re-invitable, mirrors
    //    `getCurrentActor`'s "detached ⇒ no role" rule).
    //
    //    The « attached but no password account » case is the wizard
    //    step-1-then-step-7 flow: `provisionTenant` stamps a bare `users` row
    //    from `prospect.email` AND attaches it `kb_manager` to the new tenant
    //    BEFORE the gérant has ever signed up. Step 7 must send that gérant
    //    the FIRST magic-link — refusing ALREADY_MEMBER here would block the
    //    canonical onboarding flow and the gérant would have no way to ever
    //    loginner (root cause AC2 E2E bug). Cf. PRD 70 §3.6: « step 1 crée
    //    déjà la ligne userTenants ; step 7 = envoi du lien magique ».
    const existingUser = await getUserByEmail(ctx, args.email);
    if (existingUser !== null) {
      const active = await getActiveUserTenant(
        ctx,
        existingUser._id,
        args.tenantId,
      );
      if (active !== null) {
        const hasAccount = await hasPasswordAccount(ctx, existingUser._id);
        if (hasAccount) {
          throw new ConvexError({
            code: "ALREADY_MEMBER",
            message: `${args.email} is already a gérant on this tenant.`,
          });
        }
        // else: attached but never signed up → fall through and send the
        // first magic-link (wizard step 1 → step 7 canonical path).
      }
    }

    // 3. Pending / relance guard on the (email, tenantId) couple via the
    //    `by_email_tenant` compound index (B-AUTH-3). A non-expired,
    //    not-yet-accepted invite blocks; an EXPIRED one is deleted so a fresh
    //    one can take its place (relance).
    const existingInvite = await getManagerInviteForTenant(
      ctx,
      args.email,
      args.tenantId,
    );
    if (existingInvite !== null) {
      const stillPending =
        existingInvite.acceptedAt === undefined &&
        existingInvite.expiresAt > Date.now();
      if (stillPending) {
        throw new ConvexError({
          code: "ALREADY_INVITED",
          message: `An invitation has already been sent to ${args.email} for this tenant.`,
        });
      }
      // Expired (or somehow accepted but stuck) → drop it so a fresh invite
      // can replace it. Same transaction: a later throw would roll this back.
      await deleteAdminInvite(ctx, existingInvite._id);
    }

    // 4. Insert the fresh manager invite via the sanctioned seam.
    const resolvedName = args.name ?? defaultNameFromEmail(args.email);
    const token = generateToken();
    const inviteId = await insertManagerInvite(ctx, {
      email: args.email,
      name: resolvedName,
      token,
      invitedBy: ctx.actor.userId,
      expiresAt: Date.now() + SEVEN_DAYS_MS,
      tenantId: args.tenantId,
    });

    // 5. B-AUTH-5 — schedule the magic-link email. `tenantName` is a SNAPSHOT
    //    of the tenant doc read at step 1: a later rename does NOT mutate
    //    emails already sent. The scheduled action runs after the mutation
    //    commits; a throw between here and return would roll BOTH the
    //    insert AND the scheduled job back (same transaction).
    await ctx.scheduler.runAfter(0, internal.emails.sendManagerInviteEmail, {
      to: args.email,
      name: resolvedName,
      token,
      tenantName: tenant.name,
    });

    return inviteId;
  },
});

/**
 * F-WIZARD [9/10] (#273) — `getLatestManagerInviteForTenant(tenantId)`,
 * root-only read used by the wizard's Step 7 + `useWizardState`.
 *
 * Wrapper: `kbAdminQuery` — V1 strict, only KB Admin can introspect a tenant's
 * manager invite history. Reads via the sanctioned `lib/tenancy/adminInvitesStore`
 * seam (ADR 0010 / `no-untenanted-query`).
 *
 * Returns the most recently created `kb_manager` invite row for `tenantId`
 * (any `acceptedAt`, any `expiresAt`) or `null` if none has ever been emitted
 * for the tenant. The wizard uses this for two things:
 *   1. `useWizardState` step-7 completion gate (issue AC: « marque step 7
 *      complete si une ligne managerInvites existe pour le tenant »).
 *   2. The Step 7 form surfaces the « envoyée le DD/MM HH:MM » badge + the
 *      « Renvoyer » affordance when this returns a row.
 *
 * Convex registers this by module path, so callers invoke
 * `api.lib.admin.managerInvites.getLatestManagerInviteForTenant`.
 */
export const getLatestManagerInviteForTenant = kbAdminQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<Doc<"adminInvites"> | null> =>
    readLatestManagerInviteForTenant(ctx, args.tenantId),
});
