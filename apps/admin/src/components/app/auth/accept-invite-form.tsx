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
import { PasswordInput } from "@/components/custom/password-input";
import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery } from "convex/react";
import * as z from "zod";
import { api } from "@packages/backend/convex/_generated/api";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Spinner } from "@/components/ui/spinner";

const formSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export function AcceptInviteForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const { signIn } = useAuthActions();
  const acceptInvite = useMutation(api.table.admin.acceptInvite);

  const invite = useQuery(api.table.admin.getInvite, token ? { token } : "skip");

  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: z.infer<typeof formSchema>) {
    if (!invite?.invite) return;

    setIsLoading(true);
    setFormError(null);

    try {
      // Sign up with the email from the invite
      await signIn("password", {
        email: invite.invite.email,
        password: data.password,
        flow: "signUp",
      });

      // Accept the invite (sets role to admin)
      await acceptInvite({ token });

      // Redirect to dashboard
      router.replace("/dashboard");
    } catch (error) {
      setFormError(getConvexErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  // Show loading while fetching invite
  if (invite === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // Show error if invite is invalid
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

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-6 md:p-8">
          <form id="form-accept-invite" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Welcome, {invite.invite.name}!</h1>
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
                  form="form-accept-invite"
                  disabled={isLoading}
                >
                  {isLoading ? <Spinner /> : "Create Account"}
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
