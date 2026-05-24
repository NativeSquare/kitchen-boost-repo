"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function SiteHeader() {
  const pathname = usePathname()

  const getBreadcrumbs = () => {
    const segments = pathname.split("/").filter(Boolean)

    if (segments.length === 0) {
      return [{ label: "General", href: "/", isCurrentPage: true }]
    }

    if (segments[0] === "team") {
      if (segments.length === 1) {
        return [{ label: "Team", href: "/team", isCurrentPage: true }]
      }
      if (segments.length === 2) {
        return [
          { label: "Team", href: "/team", isCurrentPage: false },
          { label: "Member Details", href: pathname, isCurrentPage: true },
        ]
      }
    }

    if (segments[0] === "users") {
      if (segments.length === 1) {
        return [{ label: "Users", href: "/users", isCurrentPage: true }]
      }
      if (segments.length === 2) {
        return [
          { label: "Users", href: "/users", isCurrentPage: false },
          { label: "User Details", href: pathname, isCurrentPage: true },
        ]
      }
    }

    return [{ label: "General", href: "/", isCurrentPage: true }]
  }

  const breadcrumbs = getBreadcrumbs()

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/team">General</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.href} className="flex items-center gap-1.5">
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {crumb.isCurrentPage ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  )
}
