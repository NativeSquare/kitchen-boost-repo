"use client";

import { AdminTable } from "@/components/app/dashboard/admin-table";
import { PendingInvites } from "@/components/app/dashboard/pending-invites";
import { InviteDialog } from "@/components/app/dashboard/invite-dialog";

export default function TeamPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Team</h1>
            <p className="text-muted-foreground text-sm">
              Manage your admin team members here.
            </p>
          </div>
          <InviteDialog />
        </div>
      </div>
      <div className="px-4 lg:px-6">
        <PendingInvites />
      </div>
      <div className="px-4 lg:px-6">
        <AdminTable />
      </div>
    </div>
  );
}
