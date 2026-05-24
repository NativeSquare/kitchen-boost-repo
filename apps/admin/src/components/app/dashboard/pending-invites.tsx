"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { toast } from "sonner";
import { IconMail, IconX, IconClock } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;

  if (diff <= 0) {
    return "Expired";
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) {
    return `${days}d ${hours}h remaining`;
  }
  return `${hours}h remaining`;
}

export function PendingInvites() {
  const invites = useQuery(api.table.admin.listInvites);
  const cancelInvite = useMutation(api.table.admin.cancelInvite);

  const [cancelDialogOpen, setCancelDialogOpen] = React.useState(false);
  const [inviteToCancel, setInviteToCancel] = React.useState<Id<"adminInvites"> | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const handleCancel = async () => {
    if (!inviteToCancel) return;

    setIsLoading(true);
    try {
      await cancelInvite({ inviteId: inviteToCancel });
      toast.success("Invitation cancelled");
    } catch (error) {
      toast.error("Failed to cancel invitation", {
        description: getConvexErrorMessage(error),
      });
    } finally {
      setIsLoading(false);
      setCancelDialogOpen(false);
      setInviteToCancel(null);
    }
  };

  // Don't render anything if there are no pending invites
  if (invites === undefined) {
    return null;
  }

  if (invites.length === 0) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <IconMail className="h-4 w-4" />
            Pending Invitations
          </CardTitle>
          <CardDescription>
            {invites.length} pending invitation{invites.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {invites.map((invite) => (
              <div
                key={invite._id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{invite.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      <IconClock className="mr-1 h-3 w-3" />
                      {formatTimeRemaining(invite.expiresAt)}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">{invite.email}</span>
                  {invite.inviterName && (
                    <span className="text-xs text-muted-foreground">
                      Invited by {invite.inviterName}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setInviteToCancel(invite._id);
                    setCancelDialogOpen(true);
                  }}
                >
                  <IconX className="h-4 w-4" />
                  <span className="sr-only">Cancel invitation</span>
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this invitation? The invite link will no longer work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Keep Invitation</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? <Spinner className="mr-2" /> : null}
              Cancel Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
