"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  IconChevronRight,
  IconDotsVertical,
  IconInnerShadowTop,
  IconLogout,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/site-header";

// --- Types ---

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  children?: NavItem[];
};

type NavGroup = {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

// --- Navigation data ---

const navGroups: NavGroup[] = [
  {
    title: "General",
    defaultOpen: true,
    items: [
      { label: "Users", icon: IconUsersGroup, href: "/users" },
      { label: "Team", icon: IconUsers, href: "/team" },
    ],
  },
];

// --- Helpers ---

function getInitials(name: string): string {
  if (!name) return "AD";
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// --- Sub-components ---

const NavMenuItem = ({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) => {
  const Icon = item.icon;
  const hasChildren = item.children && item.children.length > 0;
  const active = isRouteActive(pathname, item.href);

  if (!hasChildren) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
          <Link href={item.href}>
            <Icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible asChild defaultOpen={active} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={active} tooltip={item.label}>
            <Icon className="size-4" />
            <span>{item.label}</span>
            <IconChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children?.map((child) => (
              <SidebarMenuSubItem key={child.label}>
                <SidebarMenuSubButton
                  asChild
                  isActive={isRouteActive(pathname, child.href)}
                >
                  <Link href={child.href}>{child.label}</Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
};

const NavUser = ({
  user,
}: {
  user: { name: string; email: string; avatar: string };
}) => {
  const { signOut } = useAuthActions();
  const router = useRouter();

  async function handleLogout() {
    await signOut();
    router.push("/login");
  }

  const initials = getInitials(user.name);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout}>
              <IconLogout className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

const AppSidebar = ({ ...props }: React.ComponentProps<typeof Sidebar>) => {
  const pathname = usePathname();
  const currentAdmin = useQuery(api.table.admin.currentAdmin);

  const user = currentAdmin
    ? {
        name: currentAdmin.name || "Admin",
        email: currentAdmin.email || "",
        avatar: currentAdmin.image || "",
      }
    : null;

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Admin Panel">
              <Link href="/team">
                <div className="flex aspect-square size-8 items-center justify-center rounded-sm bg-primary">
                  <IconInnerShadowTop className="size-5 text-primary-foreground" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium">Admin Panel</span>
                  <span className="text-xs text-muted-foreground">
                    Management
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavMenuItem
                    key={item.label}
                    item={item}
                    pathname={pathname}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        {user ? (
          <NavUser user={user} />
        ) : (
          <div className="flex items-center gap-2 p-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};

// --- Main Shell ---

interface ApplicationShellProps {
  children: React.ReactNode;
}

export function ApplicationShell({ children }: ApplicationShellProps) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
