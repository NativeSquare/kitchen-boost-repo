"use node";

import { Resend } from "@convex-dev/resend";
import { internalAction } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { APP_ADDRESS, APP_DOMAIN, APP_NAME } from "@packages/shared/constants";
import { renderAdminInviteHtml } from "@packages/transactional";

// Initialize the Resend component
// Set testMode: false when ready for production
export const resend = new Resend(components.resend, {
  testMode: process.env.IS_DEV === "true",
});

// Default sender address
const DEFAULT_FROM = `${APP_NAME} <no-reply@${APP_DOMAIN}>`;

/**
 * Base URL of the **admin** app (`apps/admin`, port 3000 in dev) — that's
 * where `/accept-invite` lives for BOTH admin and manager invites. The PWA
 * (`apps/web`, port 3001) does NOT host this page.
 *
 * Reads `SITE_URL` (the canonical project env var — see README §5d and
 * `docs/contexts/_architecture/STACK.md`). Falls back to `http://localhost:3000`
 * locally. **Never** fall back to `localhost:3001` here: a magic-link that
 * lands on the PWA is a dead link and the invitee cannot complete onboarding
 * (regression caught in E2E AC2 — Alex, 2026-06-03).
 */
export function getAdminBaseUrl(): string {
  return process.env.SITE_URL || "http://localhost:3000";
}

/**
 * Generic email sending action that accepts pre-rendered HTML.
 * Use this as a base for specific email actions.
 */
export const sendEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    from: v.optional(v.string()),
    replyTo: v.optional(v.array(v.string())),
  },
  returns: v.string(), // Returns EmailId
  handler: async (ctx, args) => {
    const emailId = await resend.sendEmail(ctx, {
      from: args.from ?? DEFAULT_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
    });
    return emailId;
  },
});

// =============================================================================
// Admin Invite Email (plain HTML – no React rendering in Node)
// =============================================================================

export const sendAdminInviteEmail = internalAction({
  args: {
    to: v.string(),
    name: v.string(),
    token: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const inviteUrl = `${getAdminBaseUrl()}/accept-invite?token=${args.token}`;

    const isDev = process.env.IS_DEV === "true";
    if (isDev) {
      console.log(`[DEV] Admin invite email to ${args.to}`);
      console.log(`[DEV] Invite URL: ${inviteUrl}`);
      return "dev-email-id";
    }

    const html = renderAdminInviteHtml(
      { name: args.name, inviteUrl },
      { appName: APP_NAME, appAddress: APP_ADDRESS },
    );

    const emailId = await resend.sendEmail(ctx, {
      from: DEFAULT_FROM,
      to: args.to,
      subject: `You're invited to join ${APP_NAME} Admin`,
      html,
    });

    return emailId;
  },
});

// =============================================================================
// Manager Invite Email (B-AUTH-5 — décalque strict de `sendAdminInviteEmail`
// avec deux différences : mentionne explicitement le nom du resto (`tenantName`)
// dans l'objet ET le corps de l'email pour que le gérant sache à quel
// restaurant l'invite se rattache (cas Walid Thai Street : un même gérant peut
// recevoir N invites distinctes sur N tenants différents — chaque email doit
// être self-contained). Le lien d'acceptation pointe vers la MÊME page
// `/accept-invite?token=…` que les invites admin — la mutation `acceptInvite`
// est étendue en B-AUTH-6 pour discriminer admin vs manager via `targetRole`
// stocké sur la ligne `adminInvites`.
//
// Pas de helper dans `@packages/transactional` pour cette variante : le
// template est inline ici (parallèle au décalque admin), évitant de toucher
// un autre package. Le moment où `acceptInvite` est mergé pourra unifier les
// deux templates derrière un seul `renderManagerInviteHtml` si la duplication
// devient inconfortable, mais c'est out-of-scope ici.
// =============================================================================

/**
 * Plain-HTML render of the manager invite email (no React in Node — same
 * discipline as `renderAdminInviteHtml`).
 */
function renderManagerInviteHtmlInline(props: {
  name: string;
  inviteUrl: string;
  tenantName: string;
}): string {
  const { name, inviteUrl, tenantName } = props;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#51525C;">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
    <p style="font-size:14px;margin:8px 0;">Hi ${escapeHtml(name)},</p>
    <p style="font-size:14px;margin:8px 0;">You've been invited to manage <strong>${escapeHtml(tenantName)}</strong> on ${escapeHtml(APP_NAME)}.</p>
    <p style="font-size:14px;margin:8px 0;">Click the button below to set up your account and get started:</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:6px;">Accept Invitation</a>
    </p>
    <p style="font-size:14px;margin:8px 0;">This invitation will expire in 7 days.</p>
    <p style="font-size:14px;margin:8px 0;">If you didn't expect this invitation, you can safely ignore this email.</p>
    <p style="font-size:14px;margin:8px 0;">Thanks,</p>
    <p style="font-size:14px;margin:8px 0;">The ${escapeHtml(APP_NAME)} Team</p>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
    <p style="font-size:14px;margin:8px 0;color:#51525C;">© 2026 ${escapeHtml(APP_NAME)}, ${escapeHtml(APP_ADDRESS)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const sendManagerInviteEmail = internalAction({
  args: {
    to: v.string(),
    name: v.string(),
    token: v.string(),
    tenantName: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Same acceptance endpoint as admin invites — `acceptInvite` (B-AUTH-6)
    // discriminates the two flows by reading the invite's `targetRole`.
    const inviteUrl = `${getAdminBaseUrl()}/accept-invite?token=${args.token}`;

    const isDev = process.env.IS_DEV === "true";
    if (isDev) {
      console.log(
        `[DEV] Manager invite email to ${args.to} for tenant "${args.tenantName}"`,
      );
      console.log(`[DEV] Invite URL: ${inviteUrl}`);
      return "dev-email-id";
    }

    const html = renderManagerInviteHtmlInline({
      name: args.name,
      inviteUrl,
      tenantName: args.tenantName,
    });

    const emailId = await resend.sendEmail(ctx, {
      from: DEFAULT_FROM,
      to: args.to,
      subject: `You're invited to manage ${args.tenantName} on ${APP_NAME}`,
      html,
    });

    return emailId;
  },
});
