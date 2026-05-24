"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { toast } from "sonner";
import { IconUserPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  name: z.string().min(1, "Name is required").min(2, "Name must be at least 2 characters"),
});

export function InviteDialog() {
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  const inviteAdmin = useMutation(api.table.admin.inviteAdmin);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      name: "",
    },
  });

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      await inviteAdmin({
        email: data.email,
        name: data.name,
      });

      toast.success("Invitation sent successfully", {
        description: `An invitation email has been sent to ${data.email}`,
      });

      form.reset();
      setOpen(false);
    } catch (error) {
      toast.error("Failed to send invitation", {
        description: getConvexErrorMessage(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <IconUserPlus className="mr-2 h-4 w-4" />
          Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Send an invitation to join the admin team. They will receive an email with a link to
            create their account.
          </DialogDescription>
        </DialogHeader>

        <form id="invite-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="name"
                    placeholder="John Doe"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    {...field}
                    id="email"
                    type="email"
                    placeholder="john@example.com"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="submit" form="invite-form" disabled={isLoading}>
            {isLoading ? <Spinner className="mr-2" /> : null}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
