// Email Templates (React – for local preview only)
export { AdminInviteEmail } from "./emails/admin-invite";
export { ForgotPassword } from "./emails/forgot-password";
export { VerifyEmail } from "./emails/verify-email";

// Plain HTML templates (use these in backend to avoid React in Node)
export {
  renderAdminInviteHtml,
  renderForgotPasswordHtml,
  renderVerifyEmailHtml,
  type EmailTemplateOptions,
} from "./emails/html-templates";
