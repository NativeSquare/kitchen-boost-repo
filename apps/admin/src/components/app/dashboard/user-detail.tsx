"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import {
  IconArrowLeft,
  IconUserShield,
  IconUser,
  IconTrash,
  IconBan,
  IconLockOpen,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  name: z.string().optional(),
  bio: z.string().optional(),
  role: z.enum(["user", "admin"]),
});

interface UserDetailProps {
  userId: Id<"users">;
  /** Path to navigate back to. Defaults to "/team" */
  backPath?: string;
}

export function UserDetail({ userId, backPath = "/team" }: UserDetailProps) {
  const router = useRouter();
  const user = useQuery(api.table.admin.getUser, { userId });
  const updateUser = useMutation(api.table.admin.updateUser);
  const deleteUser = useMutation(api.table.admin.deleteUser);
  const banUser = useMutation(api.table.admin.banUser);
  const unbanUser = useMutation(api.table.admin.unbanUser);

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isBanning, setIsBanning] = React.useState(false);
  const [isUnbanning, setIsUnbanning] = React.useState(false);
  const [banDialogOpen, setBanDialogOpen] = React.useState(false);
  const [banReason, setBanReason] = React.useState("");
  const [banDuration, setBanDuration] = React.useState("permanent");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      bio: "",
      role: "user",
    },
  });

  // Update form values when user data loads
  React.useEffect(() => {
    if (user) {
      form.reset({
        name: user.name ?? "",
        bio: user.bio ?? "",
        role: user.role ?? "user",
      });
    }
  }, [user, form]);

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    try {
      await updateUser({
        userId,
        updates: {
          name: data.name || undefined,
          bio: data.bio || undefined,
          role: data.role,
        },
      });
      toast.success("User updated successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update user"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteUser({ userId });
      toast.success("User deleted successfully");
      router.push(backPath);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete user"
      );
      setIsDeleting(false);
    }
  };

  const handleBan = async () => {
    setIsBanning(true);
    try {
      const durationMap: Record<string, number | undefined> = {
        permanent: undefined,
        "1d": 60 * 60 * 24,
        "7d": 60 * 60 * 24 * 7,
        "30d": 60 * 60 * 24 * 30,
      };
      await banUser({
        userId,
        banReason: banReason || undefined,
        banExpiresIn: durationMap[banDuration],
      });
      toast.success("User has been banned");
      setBanDialogOpen(false);
      setBanReason("");
      setBanDuration("permanent");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to ban user"
      );
    } finally {
      setIsBanning(false);
    }
  };

  const handleUnban = async () => {
    setIsUnbanning(true);
    try {
      await unbanUser({ userId });
      toast.success("User has been unbanned");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to unban user"
      );
    } finally {
      setIsUnbanning(false);
    }
  };

  const isBanned =
    user?.banned && (!user.banExpires || user.banExpires > Date.now());

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (user === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">User not found</p>
        <Button variant="outline" onClick={() => router.push(backPath)}>
          <IconArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(backPath)}
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{user.name || "Unnamed User"}</h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          {isBanned && (
            <Badge variant="destructive">
              <IconBan className="mr-1 h-3 w-3" />
              Banned
            </Badge>
          )}
          <Badge
            variant={user.role === "admin" ? "default" : "outline"}
            className="capitalize"
          >
            {user.role === "admin" ? (
              <IconUserShield className="mr-1 h-3 w-3" />
            ) : (
              <IconUser className="mr-1 h-3 w-3" />
            )}
            {user.role || "user"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* User Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>User Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Created</span>
                <p className="font-medium">{formatDate(user._creationTime)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Email Verified</span>
                <p className="font-medium">
                  {user.emailVerificationTime
                    ? formatDate(user.emailVerificationTime)
                    : "Not verified"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Phone</span>
                <p className="font-medium">{user.phone || "Not set"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Onboarding</span>
                <p className="font-medium">
                  {user.hasCompletedOnboarding ? "Completed" : "Not completed"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit Form Card */}
        <Card>
          <CardHeader>
            <CardTitle>Edit User</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Controller
                name="name"
                control={form.control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input {...field} id="name" placeholder="User's name" />
                  </div>
                )}
              />

              <Controller
                name="bio"
                control={form.control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea
                      {...field}
                      id="bio"
                      placeholder="User's bio"
                      rows={3}
                    />
                  </div>
                )}
              />

              <Controller
                name="role"
                control={form.control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="role">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
                Save Changes
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Moderation */}
      {user.role !== "admin" && (
        <Card className={isBanned ? "border-destructive" : ""}>
          <CardHeader>
            <CardTitle>Moderation</CardTitle>
          </CardHeader>
          <CardContent>
            {isBanned ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-2">
                  <p className="text-sm font-medium text-destructive">
                    This user is currently banned
                  </p>
                  {user.banReason && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">Reason:</span>{" "}
                      {user.banReason}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">Expires:</span>{" "}
                    {user.banExpires
                      ? formatDate(user.banExpires)
                      : "Permanent"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleUnban}
                  disabled={isUnbanning}
                >
                  {isUnbanning ? (
                    <Spinner className="mr-2 h-4 w-4" />
                  ) : (
                    <IconLockOpen className="mr-2 h-4 w-4" />
                  )}
                  Unban User
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Ban User</p>
                  <p className="text-muted-foreground text-sm">
                    Prevent this user from signing in and revoke all their
                    sessions.
                  </p>
                </div>
                <AlertDialog
                  open={banDialogOpen}
                  onOpenChange={setBanDialogOpen}
                >
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <IconBan className="mr-2 h-4 w-4" />
                      Ban User
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Ban User</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will prevent the user from signing in and revoke all
                        their active sessions immediately.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label htmlFor="ban-reason">
                          Reason{" "}
                          <span className="text-muted-foreground">
                            (optional)
                          </span>
                        </Label>
                        <Input
                          id="ban-reason"
                          placeholder="e.g. Spamming, Abuse, etc."
                          value={banReason}
                          onChange={(e) => setBanReason(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ban-duration">Duration</Label>
                        <Select
                          value={banDuration}
                          onValueChange={setBanDuration}
                        >
                          <SelectTrigger id="ban-duration">
                            <SelectValue placeholder="Select duration" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="permanent">
                              Permanent
                            </SelectItem>
                            <SelectItem value="1d">1 day</SelectItem>
                            <SelectItem value="7d">7 days</SelectItem>
                            <SelectItem value="30d">30 days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleBan}
                        disabled={isBanning}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isBanning ? (
                          <Spinner className="mr-2 h-4 w-4" />
                        ) : null}
                        Confirm Ban
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Delete User</p>
              <p className="text-muted-foreground text-sm">
                Permanently delete this user and all their data.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  <IconTrash className="mr-2 h-4 w-4" />
                  Delete User
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete User</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this user? This action
                    cannot be undone. All user data, sessions, and associated
                    accounts will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isDeleting ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
