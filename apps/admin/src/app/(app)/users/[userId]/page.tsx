"use client";

import { use } from "react";
import { UserDetail } from "@/components/app/dashboard/user-detail";
import { Id } from "@packages/backend/convex/_generated/dataModel";

export default function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <UserDetail userId={userId as Id<"users">} backPath="/users" />
      </div>
    </div>
  );
}
