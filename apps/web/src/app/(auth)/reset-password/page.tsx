"use client"

import { ResetPasswordForm } from "@/components/app/auth/reset-password-form"
import { useSearchParams, redirect } from "next/navigation"

export default function ResetPasswordPage() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email")

  if (!email) {
    redirect("/forgot-password")
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-3xl">
        <ResetPasswordForm email={email} />
      </div>
    </div>
  )
}
