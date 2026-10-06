import { AlertTriangle } from "lucide-react"
import { WorkspaceSidebar } from "@/components/navigation/workspace-sidebar"
import { listCentreAnnouncements } from "@/lib/announcements/queries"
import { projectCentrePath } from "@/lib/auth/access"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES, visiblePages } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export default async function CentreLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const { project, features, centre, user } = await requireCentreUser(code)
  const announcements = await listCentreAnnouncements(await createClient(), project.id, user.userId)
  const unread = announcements.filter((a) => !a.dismissed).length

  const items = visiblePages(CENTRE_PAGES, features).map((p) => ({
    href: projectCentrePath(project.code, p.page),
    label: p.label,
    badge: p.page === "announcements" ? unread : undefined,
  }))

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{project.code}</p>
          <h1 className="mt-1 text-2xl font-semibold">{project.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground">Centre user · {centre.name}</p>
      </div>
      {!centre.active ? (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your centre has been deactivated in this project, so new uploads are paused. Contact your project admin.
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <WorkspaceSidebar title={centre.name} items={items} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
