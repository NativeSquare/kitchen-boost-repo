import { AcceptInviteForm } from "@/components/app/auth/accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <AcceptInviteForm />
      </div>
    </div>
  );
}
