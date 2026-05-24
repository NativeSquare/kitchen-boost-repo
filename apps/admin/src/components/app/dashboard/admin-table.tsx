"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  IconDotsVertical,
  IconSearch,
  IconTrash,
  IconEdit,
} from "@tabler/icons-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

type AdminData = {
  _id: Id<"users">;
  _creationTime: number;
  name?: string;
  email?: string;
  image?: string;
  role?: "user" | "admin";
  emailVerificationTime?: number;
};

function getInitials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(name: string | undefined): string {
  if (!name) return "bg-gray-400";
  const colors = [
    "bg-red-500",
    "bg-orange-500",
    "bg-amber-500",
    "bg-yellow-500",
    "bg-lime-500",
    "bg-green-500",
    "bg-emerald-500",
    "bg-teal-500",
    "bg-cyan-500",
    "bg-sky-500",
    "bg-blue-500",
    "bg-indigo-500",
    "bg-violet-500",
    "bg-purple-500",
    "bg-fuchsia-500",
    "bg-pink-500",
    "bg-rose-500",
  ];
  const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminTable() {
  const router = useRouter();
  const admins = useQuery(api.table.admin.listAdmins);
  const deleteUser = useMutation(api.table.admin.deleteUser);

  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [userToDelete, setUserToDelete] = React.useState<Id<"users"> | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const handleDelete = async () => {
    if (!userToDelete) return;
    try {
      await deleteUser({ userId: userToDelete });
      toast.success("Team member removed successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove team member");
    } finally {
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    }
  };

  const columns: Array<ColumnDef<AdminData>> = React.useMemo(
    () => [
      {
        id: "avatar",
        header: () => null,
        cell: ({ row }) => (
          <Avatar className="h-8 w-8">
            <AvatarImage src={row.original.image} alt={row.original.name} />
            <AvatarFallback className={`${getAvatarColor(row.original.name)} text-white text-xs`}>
              {getInitials(row.original.name)}
            </AvatarFallback>
          </Avatar>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name || "—"}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <Link
            href={`mailto:${row.original.email}`}
            className="text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.email || "—"}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.emailVerificationTime ? (
            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500" />
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-gray-400" />
              Inactive
            </Badge>
          ),
      },
      {
        accessorKey: "_creationTime",
        header: "Joined",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{formatDate(row.original._creationTime)}</span>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
                size="icon"
                onClick={(e) => e.stopPropagation()}
              >
                <IconDotsVertical />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem asChild>
                <Link href={`/team/${row.original._id}`}>
                  <IconEdit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setUserToDelete(row.original._id);
                  setDeleteDialogOpen(true);
                }}
              >
                <IconTrash className="mr-2 h-4 w-4" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: admins ?? [],
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (admins === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-4">
        <h2 className="text-lg font-semibold mb-2">Team Members</h2>
        <div className="relative max-w-sm">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search team members..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="cursor-pointer"
                  onClick={() => router.push(`/team/${row.original._id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No team members found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-muted-foreground text-sm py-2">
        {table.getFilteredRowModel().rows.length} team member(s)
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this team member? This action cannot be undone. They
              will lose admin access and their account data will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
