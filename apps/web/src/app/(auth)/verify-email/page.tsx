"use client"

import { OTPForm } from "@/components/app/auth/otp-form"
import { useSearchParams, redirect } from "next/navigation"

export default function VerifyEmailPage() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email")

  if (!email) {
    redirect("/signup")
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-3xl">
        <OTPForm email={email} />
      </div>
    </div>
  )
}
