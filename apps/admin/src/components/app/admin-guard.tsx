"use client";

import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useConvexAuth } from "convex/react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const admin = useQuery(
    api.table.admin.currentAdmin,
    isAuthenticated ? {} : "skip"
  );

  useEffect(() => {
    // Not loading and not authenticated -> redirect to login
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
      return;
    }

    // Authenticated but not an admin -> redirect to login with error
    if (isAuthenticated && admin === null) {
      router.replace("/login?error=admin_required");
    }
  }, [isAuthLoading, isAuthenticated, admin, router]);

  // Show loading state while checking auth/admin status
  if (isAuthLoading || admin === undefined) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // Not an admin - will be redirected
  if (!isAuthenticated || admin === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return <>{children}</>;
}
