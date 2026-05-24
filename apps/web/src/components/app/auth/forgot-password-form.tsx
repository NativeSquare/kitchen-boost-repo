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
import { Input } from "@/components/ui/input"
import { useAuthActions } from "@convex-dev/auth/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { useConvex } from "convex/react"
import * as z from "zod"
import { api } from "@packages/backend/convex/_generated/api"
import { useRouter } from "next/navigation"
import * as React from "react"
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage"
import { Spinner } from "@/components/ui/spinner"

const formSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
})

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const { signIn } = useAuthActions()
  const convex = useConvex()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setFormError(null)

    // Check if account exists
    const user = await convex.query(api.table.users.getUserByEmail, {
      email: data.email,
    })
    if (!user) {
      setFormError("No account found with this email")
      return
    }

    setIsLoading(true)
    try {
      await signIn("password", {
        email: data.email,
        flow: "reset",
      })
      router.replace(`/reset-password?email=${encodeURIComponent(data.email)}`)
    } catch (error) {
      setFormError(getConvexErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form
            className="p-6 md:p-8"
            id="form-forgot-password"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Forgot password?</h1>
                <p className="text-muted-foreground text-sm text-balance">
                  Enter your email to reset your password
                </p>
              </div>
              {formError && (
                <div className="text-destructive self-center">{formError}</div>
              )}
              <Controller
                name="email"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input
                      {...field}
                      id="email"
                      aria-invalid={fieldState.invalid}
                      type="email"
                      placeholder="m@example.com"
                      required
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
              <Field className="gap-2">
                <Button
                  type="submit"
                  form="form-forgot-password"
                  disabled={isLoading}
                >
                  {isLoading ? <Spinner /> : "Reset your password"}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => router.push("/login")}
                  disabled={isLoading}
                >
                  Back to login
                </Button>
              </Field>
              <FieldDescription className="text-center">
                Remember your password? <a href="/login">Sign in</a>
              </FieldDescription>
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
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  )
}
