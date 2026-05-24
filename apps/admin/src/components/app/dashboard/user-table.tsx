"use client";

import * as React from "react";
import { usePaginatedQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconDotsVertical,
  IconLayoutColumns,
  IconSearch,
  IconTrash,
  IconEdit,
  IconUserShield,
} from "@tabler/icons-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type UserData = {
  _id: Id<"users">;
  _creationTime: number;
  name?: string;
  email?: string;
  image?: string;
  role?: "user" | "admin";
  emailVerificationTime?: number;
  banned?: boolean;
  banExpires?: number;
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

interface UserTableProps {
  /** Base path for user detail links (e.g. "/users" -> "/users/{id}"). Defaults to "/team" */
  basePath?: string;
  /** Filter users by role. If set, only users with this role are shown */
  roleFilter?: "user" | "admin";
}

export function UserTable({ basePath = "/team", roleFilter }: UserTableProps) {
  const router = useRouter();
  const {
    results: allUsers,
    status,
    loadMore,
    isLoading,
  } = usePaginatedQuery(api.table.admin.listUsers, {}, { initialNumItems: 50 });

  const users = roleFilter
    ? allUsers.filter((u) => (u.role ?? "user") === roleFilter)
    : allUsers;

  const deleteUser = useMutation(api.table.admin.deleteUser);
  const updateUser = useMutation(api.table.admin.updateUser);

  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [userToDelete, setUserToDelete] = React.useState<Id<"users"> | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    roleFilter ? { role: false } : {}
  );
  const [globalFilter, setGlobalFilter] = React.useState("");

  const handleDelete = async () => {
    if (!userToDelete) return;
    try {
      await deleteUser({ userId: userToDelete });
      toast.success("User deleted successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete user");
    } finally {
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    }
  };

  const handleToggleRole = async (userId: Id<"users">, currentRole: "user" | "admin" | undefined) => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    try {
      await updateUser({ userId, updates: { role: newRole } });
      toast.success(`User role updated to ${newRole}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update user");
    }
  };

  const columns: Array<ColumnDef<UserData>> = React.useMemo(
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
        header: "Full name",
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
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.role === "admin" ? "Administrator" : "User"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const isBanned =
            row.original.banned &&
            (!row.original.banExpires || row.original.banExpires > Date.now());

          if (isBanned) {
            return (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                Banned
              </Badge>
            );
          }

          return row.original.emailVerificationTime ? (
            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500" />
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-gray-400" />
              Inactive
            </Badge>
          );
        },
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
                <Link href={`${basePath}/${row.original._id}`}>
                  <IconEdit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggleRole(row.original._id, row.original.role)}>
                <IconUserShield className="mr-2 h-4 w-4" />
                {row.original.role === "admin" ? "Remove Admin" : "Make Admin"}
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
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: users,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  // Load more when reaching the last page
  React.useEffect(() => {
    const { pageIndex, pageSize } = table.getState().pagination;
    const totalRows = users.length;
    const isNearEnd = (pageIndex + 1) * pageSize >= totalRows - pageSize;

    if (isNearEnd && status === "CanLoadMore") {
      loadMore(50);
    }
  }, [table.getState().pagination, users.length, allUsers.length, status, loadMore]);

  if (isLoading && allUsers.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 w-64"
          />
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <IconLayoutColumns />
                <span className="hidden lg:inline">Customize Columns</span>
                <span className="lg:hidden">Columns</span>
                <IconChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {table
                .getAllColumns()
                .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
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
                  onClick={() => router.push(`${basePath}/${row.original._id}`)}
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
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
          {table.getFilteredRowModel().rows.length} user(s) total
          {status === "LoadingMore" && " (loading more...)"}
        </div>
        <div className="flex w-full items-center gap-8 lg:w-fit">
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">
              Rows per page
            </Label>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 40, 50].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <IconChevronsLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <IconChevronLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <IconChevronRight />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <IconChevronsRight />
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this user? This action cannot be undone. All user
              data, sessions, and associated accounts will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
