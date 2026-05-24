"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { PasswordInput } from "@/components/custom/password-input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { useAuthActions } from "@convex-dev/auth/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import * as React from "react"
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage"
import { Spinner } from "@/components/ui/spinner"
import * as z from "zod"

const formSchema = z.object({
  newPassword: z
    .string()
    .min(1, "New password is required")
    .min(8, "New password must be at least 8 characters long"),
  code: z.string().length(6, "Code must be 6 digits"),
})

interface ResetPasswordFormProps extends React.ComponentProps<"div"> {
  email: string
}

export function ResetPasswordForm({
  className,
  email,
  ...props
}: ResetPasswordFormProps) {
  const router = useRouter()
  const { signIn } = useAuthActions()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      newPassword: "",
      code: "",
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setFormError(null)
    setIsLoading(true)
    try {
      await signIn("password", {
        code: data.code,
        newPassword: data.newPassword,
        email,
        flow: "reset-verification",
      })
      // Password reset successful - user is now signed in, redirect to dashboard
      router.replace("/dashboard")
    } catch (error) {
      setFormError(getConvexErrorMessage(error))
      setIsLoading(false)
    }
  }

  function handleCodeChange(value: string) {
    form.setValue("code", value)
    // Auto-submit when all 6 digits are entered
    if (value.length === 6) {
      form.handleSubmit(onSubmit)()
    }
  }

  return (
    <div
      className={cn("flex flex-col gap-6 md:min-h-[450px]", className)}
      {...props}
    >
      <Card className="flex-1 overflow-hidden p-0">
        <CardContent className="grid flex-1 p-0 md:grid-cols-2">
          <form
            className="flex flex-col justify-center p-6 md:p-8"
            id="form-reset-password"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Reset password</h1>
                <p className="text-muted-foreground text-sm text-balance">
                  Enter the code sent to {email} and set a new password
                </p>
              </div>
              {formError && (
                <div className="text-destructive self-center text-center">
                  {formError}
                </div>
              )}
              <Controller
                name="newPassword"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="newPassword">New password</FieldLabel>
                    <PasswordInput
                      {...field}
                      id="newPassword"
                      aria-invalid={fieldState.invalid}
                      required
                    />
                    <FieldDescription>
                      Must be at least 8 characters long.
                    </FieldDescription>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
              <Controller
                name="code"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="code">Verification code</FieldLabel>
                    <InputOTP
                      maxLength={6}
                      id="code"
                      value={field.value}
                      onChange={handleCodeChange}
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
                    <FieldDescription>
                      Enter the 6-digit code sent to your email.
                    </FieldDescription>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
              <Field className="gap-2">
                <Button
                  type="submit"
                  form="form-reset-password"
                  disabled={isLoading}
                >
                  {isLoading ? <Spinner /> : "Reset Password"}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => router.push("/login")}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <FieldDescription className="text-center">
                  Didn&apos;t receive the code?{" "}
                  <a href={`/forgot-password`}>Resend</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
          <div className="bg-muted relative hidden md:block">
            <img
              src="/placeholder.svg"
              alt="Image"
              className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
            />
          </div>
        </CardContent>
      </Card>
      <FieldDescription className="text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  )
}
