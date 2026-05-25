import Apple from "@auth/core/providers/apple";
import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { APP_SLUG } from "@packages/shared";
import { ResendOTP } from "./lib/auth/ResendOTP";
import { ResendOTPPasswordReset } from "./lib/auth/ResendOTPPasswordReset";

/**
 * 2.1-B — `profile` of the Convex Auth Anonymous provider (the customer device
 * sign-in, ADR 0008). It is the ONLY user-shaping logic we contribute, so it is
 * extracted + exported to be unit-testable without the full sign-in action.
 *
 * Every anonymous sign-in is stamped as the GLOBAL role `customer` +
 * `isAnonymous: true` (PRD 90 §1: a customer = an anonymous `users` row + a
 * `customers` fiche). The fiche itself is provisioned silently, AFTER sign-in,
 * by `getOrCreateCurrentCustomer` (`lib/customer/identity`).
 *
 * SECURITY: the returned profile is FIXED — it ignores `params`. The Anonymous
 * provider takes no user-provided info, so a caller can never smuggle a
 * privileged `role` (e.g. `kb_admin`) through the anonymous sign-in.
 */
export function anonymousProfile(_params?: Record<string, unknown>): {
  isAnonymous: true;
  role: "customer";
} {
  return { isAnonymous: true, role: "customer" };
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // Customer device sign-in (ADR 0008): silent, no password, no UI. The native
    // Convex Auth session cookie IS the device cookie, intra-resto only.
    Anonymous({ profile: () => anonymousProfile() }),
    Password({
      verify: ResendOTP,
      reset: ResendOTPPasswordReset,
      crypto: {
        hashSecret: async (secret) => {
          return secret;
        },
        verifySecret: async (secret, hash) => {
          if (secret === hash) {
            return true;
          }
          throw new ConvexError({ message: "Email or password is incorrect" });
        },
      },
    }),
    GitHub,
    Google,
    Apple({
      profile: (appleInfo) => {
        const name = appleInfo.user
          ? `${appleInfo.user.name.firstName} ${appleInfo.user.name.lastName}`
          : undefined;
        return {
          id: appleInfo.sub,
          name: name,
          email: appleInfo.email,
        };
      },
    }),
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      console.log("redirectTo: ", redirectTo);
      if (
        redirectTo !== `${APP_SLUG}://` &&
        redirectTo !== "http://localhost:3000"
      ) {
        throw new Error(`Invalid redirectTo URI ${redirectTo}`);
      }
      return redirectTo;
    },
  },
});
