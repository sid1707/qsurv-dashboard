"use client"

// From vrdl-next-platform components/navigation/nav-link.tsx.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useCallback, useState, type ComponentProps } from "react"
import { cn } from "@/lib/utils"

type NavLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string
  active?: boolean
}

function normalizePath(path: string): string {
  const withoutHash = path.split("#")[0] ?? path
  const withoutQuery = withoutHash.split("?")[0] ?? withoutHash
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1)
  }
  return withoutQuery
}

export function NavLink({ href, active, className, children, onClick, ...props }: NavLinkProps) {
  const pathname = usePathname()
  // The path a click started from. Pending ends as soon as the route changes, so
  // child paths (e.g. /admin/files/X) do not leave parent nav links stuck pending.
  const [navigation, setNavigation] = useState<{ to: string; from: string } | null>(null)

  const targetPath = normalizePath(href)
  const currentPath = normalizePath(pathname)
  const pending = navigation?.to === targetPath && navigation.from === currentPath

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e)
      if (e.defaultPrevented) return
      if (targetPath !== currentPath) {
        setNavigation({ to: targetPath, from: currentPath })
      }
    },
    [onClick, targetPath, currentPath],
  )

  return (
    <Link
      href={href}
      className={cn(className, pending && "opacity-70", active && pending && "opacity-80")}
      aria-busy={pending || undefined}
      onClick={handleClick}
      {...props}
    >
      <span className="inline-flex items-center gap-2">
        {pending ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
        {children}
      </span>
    </Link>
  )
}
