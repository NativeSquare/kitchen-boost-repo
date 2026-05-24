import { Email } from "@convex-dev/auth/providers/Email";
import { alphabet, generateRandomString } from "oslo/crypto";
import { renderVerifyEmailHtml } from "@packages/transactional";
import { APP_ADDRESS, APP_DOMAIN, APP_NAME } from "@packages/shared/constants";
import { Resend as ResendAPI } from "resend";

export const ResendOTP = Email({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 20, // 20 minutes
  async generateVerificationToken() {
    return generateRandomString(6, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const resend = new ResendAPI(provider.apiKey);

    const isDev = process.env.IS_DEV === "true";
    if (isDev) {
      console.log(`[DEV] Email to ${email}: Verify your email`);
      console.log(`[DEV] Verification code: ${token}`);
      return;
    }

    const html = renderVerifyEmailHtml(
      { code: token },
      { appName: APP_NAME, appAddress: APP_ADDRESS }
    );

    const { error } = await resend.emails.send({
      from: `${APP_NAME} <no-reply@${APP_DOMAIN}>`,
      to: [email],
      subject: "Verify your email",
      html,
    });

    if (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});
