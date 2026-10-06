"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/super-admin", label: "Requests", match: (p: string) => p === "/super-admin" || p.startsWith("/super-admin/requests") },
  { href: "/super-admin/projects", label: "Projects", match: (p: string) => p.startsWith("/super-admin/projects") },
  { href: "/super-admin/kits", label: "Kits", match: (p: string) => p.startsWith("/super-admin/kits") },
]

export function SuperAdminNav({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Super admin" className="flex gap-1 border-b">
      {TABS.map((tab) => {
        const active = tab.match(pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.label === "Requests" && pendingCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{pendingCount}</span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
