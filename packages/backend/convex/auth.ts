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

/**
 * PWA-S3 (#451) — Convex Auth session lifetime override for the PWA Client
 * (customer-data CONTEXT « Anonymous account », decisions-log Q3).
 *
 * Convex Auth defaults BOTH `totalDurationMs` and `inactiveDurationMs` to 30
 * days. The PWA Client needs 365 days (PRD §10 PWA Client) so a returning
 * Sophie (cookie-device intra-resto) is recognised silently for a year — the
 * « pré-remplissage 2ᵉ visite » UX is the whole point of the Anonymous flow.
 *
 * Sliding window: every authenticated hit refreshes `inactiveDurationMs`; a
 * fully-idle session still caps at `totalDurationMs = 365j` (re-submit address
 * after a year is the accepted trade-off — ADR 0008 « doublon assumé »).
 *
 * Exported as a CONSTANT so it is unit-testable + so the lifetime is documented
 * in one place rather than buried in the `convexAuth({…})` call. The PRO shell
 * (KB Admin) shares the SAME `convexAuth` instance — a 365j session there is
 * fine: the Admin is access-gated by `userTenants` rows the manager can revoke
 * via `auth.sessions.revokeSession` (#396), so an expired-by-time-only PRO
 * session is not the security control here.
 */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const PWA_SESSION_CONFIG = {
  totalDurationMs: ONE_YEAR_MS,
  inactiveDurationMs: ONE_YEAR_MS,
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  session: PWA_SESSION_CONFIG,
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
