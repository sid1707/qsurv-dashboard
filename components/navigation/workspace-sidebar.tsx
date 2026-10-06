"use client"

import { usePathname } from "next/navigation"
import { NavLink } from "@/components/navigation/nav-link"
import { cn } from "@/lib/utils"

export type SidebarItem = { href: string; label: string; badge?: number }

/**
 * Workspace sidebar, from vrdl-next-platform components/admin/admin-sidebar.tsx.
 * The workspace root (first item) is active only on its own page; other items
 * also match their sub-pages.
 */
export function WorkspaceSidebar({ title, items }: { title: string; items: SidebarItem[] }) {
  const pathname = usePathname()
  const root = items[0]?.href

  return (
    <aside className="w-full shrink-0 md:w-52 lg:w-56">
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-semibold">{title}</div>
        <nav className="flex flex-row flex-wrap gap-1 p-1 md:flex-col md:flex-nowrap" aria-label={title}>
          {items.map(({ href, label, badge }) => {
            const active = pathname === href || (href !== root && pathname.startsWith(`${href}/`))
            return (
              <NavLink
                key={href}
                href={href}
                active={active}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {label}
                {badge ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs",
                      active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                    )}
                  >
                    {badge}
                  </span>
                ) : null}
              </NavLink>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
