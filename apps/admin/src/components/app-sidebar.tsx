"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { useQuery } from "convex/react"
import { api } from "@packages/backend/convex/_generated/api"
import {
  IconInnerShadowTop,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react"

import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"

const navGeneral = [
  {
    title: "Users",
    url: "/users",
    icon: IconUsersGroup,
  },
  {
    title: "Team",
    url: "/team",
    icon: IconUsers,
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const currentAdmin = useQuery(api.table.admin.currentAdmin)

  const user = currentAdmin
    ? {
        name: currentAdmin.name || "Admin",
        email: currentAdmin.email || "",
        avatar: currentAdmin.image || "",
      }
    : null

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href="/team">
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">Admin Panel</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>General</SidebarGroupLabel>
          <SidebarMenu>
            {navGeneral.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                  tooltip={item.title}
                >
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
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
    </Sidebar>
  )
}
