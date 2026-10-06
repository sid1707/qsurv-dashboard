import { WorkspaceSidebar } from "@/components/navigation/workspace-sidebar"
import { projectAdminPath, roleLabel } from "@/lib/auth/access"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES, visiblePages } from "@/lib/projects/features"

export default async function ProjectAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const { project, features, membership } = await requireProjectAdmin(code)
  const items = visiblePages(ADMIN_PAGES, features).map((p) => ({
    href: projectAdminPath(project.code, p.page),
    label: p.label,
  }))

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{project.code}</p>
          <h1 className="mt-1 text-2xl font-semibold">{project.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {membership ? roleLabel(membership.role) : "Super admin"}
          {project.status !== "active" ? <span className="ml-2 capitalize">· {project.status}</span> : null}
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <WorkspaceSidebar title="Project admin" items={items} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
