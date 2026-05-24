/**
 * Plain HTML email templates. Use these in the backend to avoid React
 * rendering in Node (which can cause minified React errors). The React
 * components in this package remain for local preview via React Email.
 */

export interface EmailTemplateOptions {
  appName: string;
  appAddress: string;
}

/** Admin invite email – plain HTML, no React */
export function renderAdminInviteHtml(
  props: { name?: string; inviteUrl: string },
  options: EmailTemplateOptions
): string {
  const { name = "there", inviteUrl } = props;
  const { appName, appAddress } = options;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#51525C;">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
    <p style="font-size:14px;margin:8px 0;">Hi ${escapeHtml(name)},</p>
    <p style="font-size:14px;margin:8px 0;">You've been invited to join the ${escapeHtml(appName)} admin team.</p>
    <p style="font-size:14px;margin:8px 0;">Click the button below to set up your account and get started:</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:6px;">Accept Invitation</a>
    </p>
    <p style="font-size:14px;margin:8px 0;">This invitation will expire in 7 days.</p>
    <p style="font-size:14px;margin:8px 0;">If you didn't expect this invitation, you can safely ignore this email.</p>
    <p style="font-size:14px;margin:8px 0;">Thanks,</p>
    <p style="font-size:14px;margin:8px 0;">The ${escapeHtml(appName)} Team</p>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
    <p style="font-size:14px;margin:8px 0;color:#51525C;">© 2025 ${escapeHtml(appName)}, ${escapeHtml(appAddress)}</p>
  </div>
</body>
</html>`;
}

/** Verify email (OTP code) – plain HTML, no React */
export function renderVerifyEmailHtml(
  props: { code: string },
  options: EmailTemplateOptions
): string {
  const { code } = props;
  const { appName, appAddress } = options;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#51525C;">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
    <p style="font-size:14px;margin:8px 0;">Hi there,</p>
    <p style="font-size:14px;margin:8px 0;">To verify your email, please use the following code:</p>
    <p style="font-size:24px;font-weight:600;margin:24px 0;"><strong>${escapeHtml(code)}</strong></p>
    <p style="font-size:14px;margin:8px 0;">This code will only be valid for the next 5 minutes.</p>
    <p style="font-size:14px;margin:8px 0;">Thanks,</p>
    <p style="font-size:14px;margin:8px 0;">The ${escapeHtml(appName)} Team</p>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
    <p style="font-size:14px;margin:8px 0;color:#51525C;">© 2025 ${escapeHtml(appName)}, ${escapeHtml(appAddress)}</p>
  </div>
</body>
</html>`;
}

/** Forgot password (OTP code) – plain HTML, no React */
export function renderForgotPasswordHtml(
  props: { code: string },
  options: EmailTemplateOptions
): string {
  const { code } = props;
  const { appName, appAddress } = options;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#51525C;">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
    <p style="font-size:14px;margin:8px 0;">Hi there,</p>
    <p style="font-size:14px;margin:8px 0;">To reset your password, please use the following code:</p>
    <p style="font-size:24px;font-weight:600;margin:24px 0;"><strong>${escapeHtml(code)}</strong></p>
    <p style="font-size:14px;margin:8px 0;">This code will only be valid for the next 5 minutes.</p>
    <p style="font-size:14px;margin:8px 0;">Thanks,</p>
    <p style="font-size:14px;margin:8px 0;">The ${escapeHtml(appName)} Team</p>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
    <p style="font-size:14px;margin:8px 0;color:#51525C;">© 2025 ${escapeHtml(appName)}, ${escapeHtml(appAddress)}</p>
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
