"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { PasswordInput } from "@/components/custom/password-input";
import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import * as z from "zod";
import { api } from "@packages/backend/convex/_generated/api";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Spinner } from "@/components/ui/spinner";

/**
 * Accept-invite flow for the `apps/admin` shell.
 *
 * Two-step UX because Convex Auth's Password provider in this project is
 * configured with `verify: ResendOTP` ([packages/backend/convex/auth.ts]):
 *
 *   1. `flow: "signUp"` creates the user + authAccount + emits an OTP via
 *      Resend (logged to the Convex terminal when `IS_DEV=true`). The user is
 *      NOT yet authenticated at this point.
 *   2. The user enters the 6-digit OTP. `flow: "email-verification"` verifies
 *      it AND authenticates the session. Only THEN can we call `acceptInvite`
 *      (it requires an authenticated caller — see
 *      `packages/backend/convex/table/admin.ts:354`).
 *
 * Subtlety: even though `signIn(... "email-verification")` returns successfully
 * from the server's point of view, the React-side Convex auth context needs a
 * tick to propagate the new auth state. Calling `acceptInvite` synchronously
 * on the next line would race and crash with "Not authenticated" — the
 * mutation would still be sent with the previous unauthenticated context.
 * We therefore split the trigger from the action: the OTP submit flips the
 * phase to "waiting-auth", and a `useEffect` watches `useConvexAuth()
 * .isAuthenticated`; once it's true we run `acceptInvite` + redirect.
 *
 * The original scaffold called `acceptInvite` immediately after `signUp` and
 * crashed with "Not authenticated. Please sign up first." This component fixes
 * BOTH problems (no OTP step, race condition) by walking the proper flow.
 */

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type Phase = "password" | "otp" | "waiting-auth" | "finalising";

export function AcceptInviteForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const { signIn } = useAuthActions();
  const acceptInvite = useMutation(api.table.admin.acceptInvite);
  // We must observe this to break the race condition between `signIn` flipping
  // the auth cookies and the next mutation call seeing the new context. The
  // `useEffect` below uses it to gate the `acceptInvite` call.
  const { isAuthenticated } = useConvexAuth();

  // `useQuery` is skipped when `token` is empty (URL sans `?token=`, lien
  // tronqué dans un client mail, etc.) — in that case `inviteQuery` reste
  // `undefined` indéfiniment. On force la résolution à `null` (fallback
  // "Invalid invitation") pour ne PAS laisser le spinner tourner ad vitam.
  // C'est A5 de la checklist E2E.
  const inviteQuery = useQuery(
    api.table.admin.getInvite,
    token ? { token } : "skip",
  );
  const invite = token === "" ? null : inviteQuery;

  const [phase, setPhase] = React.useState<Phase>("password");
  const [otp, setOtp] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  // -------------------------------------------------------------------------
  // Step 1: submit password → signUp → OTP emitted to email
  // -------------------------------------------------------------------------
  async function onPasswordSubmit(data: z.infer<typeof passwordSchema>) {
    if (!invite?.invite) return;

    setIsLoading(true);
    setFormError(null);

    try {
      await signIn("password", {
        email: invite.invite.email,
        password: data.password,
        flow: "signUp",
      });
      // signUp succeeded: account + verification code created. The session
      // is NOT yet authenticated — we must verify the OTP first. Move to
      // step 2.
      setPhase("otp");
    } catch (error) {
      setFormError(getConvexErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: submit OTP → email-verification → flip to "waiting-auth"
  //         (acceptInvite is fired by the useEffect once isAuthenticated flips)
  // -------------------------------------------------------------------------
  async function onOtpSubmit(submittedCode?: string) {
    if (!invite?.invite) return;
    const value = submittedCode ?? otp;
    setFormError(null);

    if (value.length !== 6) {
      setFormError("Please enter the complete 6-digit code");
      return;
    }

    setIsLoading(true);
    try {
      // Verify the OTP. On success, Convex Auth marks the email verified AND
      // authenticates the session — but the React context hasn't propagated
      // yet, so do NOT chain acceptInvite here.
      await signIn("password", {
        email: invite.invite.email,
        code: value,
        flow: "email-verification",
      });
      // Hand off to the useEffect below.
      setPhase("waiting-auth");
    } catch (error) {
      setFormError(getConvexErrorMessage(error));
      setIsLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: once auth context has propagated, accept the invite + redirect.
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    if (phase !== "waiting-auth" || !isAuthenticated) return;
    // Flip phase synchronously to guard against a re-fire if isAuthenticated
    // flickers; React's effect won't re-run mid-handler.
    setPhase("finalising");
    (async () => {
      try {
        await acceptInvite({ token });
        router.replace("/");
      } catch (error) {
        setFormError(getConvexErrorMessage(error));
        setIsLoading(false);
        // Revert so the user can see the error and retry (e.g. invite expired
        // while they typed the OTP). They're authenticated at this point but
        // not yet kb_admin — re-entering the OTP would no-op, so kick them
        // back to the OTP step where the error message displays.
        setPhase("otp");
      }
    })();
  }, [phase, isAuthenticated, acceptInvite, token, router]);

  function handleOtpChange(value: string) {
    setOtp(value);
    // Auto-submit when all 6 digits are entered, mirroring OTPForm UX.
    if (value.length === 6) {
      onOtpSubmit(value);
    }
  }

  function handleOtpFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    onOtpSubmit();
  }

  // -------------------------------------------------------------------------
  // Loading / invalid invite branches
  // -------------------------------------------------------------------------
  if (invite === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card className="overflow-hidden p-0">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col items-center gap-4 text-center">
              <h1 className="text-2xl font-bold text-destructive">
                Invalid Invitation
              </h1>
              <p className="text-muted-foreground">
                This invitation link is invalid, expired, or has already been
                used.
              </p>
              <Button variant="outline" onClick={() => router.push("/login")}>
                Go to Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 1 UI: password
  // -------------------------------------------------------------------------
  if (phase === "password") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card className="overflow-hidden p-0">
          <CardContent className="p-6 md:p-8">
            <form
              id="form-accept-invite-password"
              onSubmit={form.handleSubmit(onPasswordSubmit)}
            >
              <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                  <h1 className="text-2xl font-bold">
                    Welcome, {invite.invite.name}!
                  </h1>
                  <p className="text-muted-foreground text-balance">
                    You&apos;ve been invited to join the admin team
                    {invite.inviterName && ` by ${invite.inviterName}`}.
                  </p>
                </div>

                {formError && (
                  <div className="text-destructive self-center text-sm">
                    {formError}
                  </div>
                )}

                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <div className="text-muted-foreground text-sm">
                    {invite.invite.email}
                  </div>
                </Field>

                <Controller
                  name="password"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <PasswordInput
                        {...field}
                        id="password"
                        aria-invalid={fieldState.invalid}
                        placeholder="Create a password"
                        required
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name="confirmPassword"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="confirmPassword">
                        Confirm Password
                      </FieldLabel>
                      <PasswordInput
                        {...field}
                        id="confirmPassword"
                        aria-invalid={fieldState.invalid}
                        placeholder="Confirm your password"
                        required
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Field>
                  <Button
                    type="submit"
                    form="form-accept-invite-password"
                    disabled={isLoading}
                  >
                    {isLoading ? <Spinner /> : "Continue"}
                  </Button>
                </Field>

                <FieldDescription className="text-center">
                  By creating an account, you agree to our{" "}
                  <a href="#">Terms of Service</a> and{" "}
                  <a href="#">Privacy Policy</a>.
                </FieldDescription>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 UI: OTP (and "finalising" message while acceptInvite runs)
  // -------------------------------------------------------------------------
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-6 md:p-8">
          <form
            id="form-accept-invite-otp"
            onSubmit={handleOtpFormSubmit}
            className="flex flex-col items-center"
          >
            <FieldGroup>
              <Field className="items-center text-center">
                <h1 className="text-2xl font-bold">Enter verification code</h1>
                <p className="text-muted-foreground text-sm text-balance">
                  We sent a 6-digit code to {invite.invite.email}
                </p>
              </Field>

              {formError && (
                <div className="text-destructive self-center text-center text-sm">
                  {formError}
                </div>
              )}

              {phase === "waiting-auth" || phase === "finalising" ? (
                <Field className="items-center text-center">
                  <Spinner className="h-8 w-8" />
                  <p className="text-muted-foreground text-sm">
                    Finalising your account…
                  </p>
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="otp" className="sr-only">
                    Verification code
                  </FieldLabel>
                  <InputOTP
                    maxLength={6}
                    id="otp"
                    value={otp}
                    onChange={handleOtpChange}
                    required
                    containerClassName="gap-4"
                    disabled={isLoading}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                  <FieldDescription className="text-center">
                    Enter the 6-digit code sent to your email.
                  </FieldDescription>
                </Field>
              )}

              {phase !== "waiting-auth" && phase !== "finalising" && (
                <Field className="gap-2">
                  <Button
                    type="submit"
                    form="form-accept-invite-otp"
                    disabled={isLoading}
                  >
                    {isLoading ? <Spinner /> : "Verify & accept invite"}
                  </Button>
                </Field>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
