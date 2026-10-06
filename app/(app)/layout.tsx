import Link from "next/link"
import { QSurvLogo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { resolveHomePath } from "@/lib/auth/access"
import { signOutAction } from "@/lib/auth/actions"
import { requireUserContext } from "@/lib/auth/context"

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const context = await requireUserContext()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link href={resolveHomePath(context)} aria-label="QSurv home">
            <QSurvLogo size={28} />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {context.fullName || context.email}
            </span>
            {context.projects.length > 1 || context.isSuperAdmin ? (
              <Link href="/projects" className="text-sm underline-offset-4 hover:underline">
                Projects
              </Link>
            ) : null}
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6">{children}</main>
    </div>
  )
}
