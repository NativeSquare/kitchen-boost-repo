"use client";

import { AdminGuard } from "@/components/app/admin-guard";
import { ApplicationShell } from "@/components/application-shell2";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <ApplicationShell>{children}</ApplicationShell>
    </AdminGuard>
  );
}
