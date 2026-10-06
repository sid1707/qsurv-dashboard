export type MembershipRole = "project_admin" | "centre_user"

export type ProjectAccess = {
  projectId: string
  code: string
  title: string
  status: string
  role: MembershipRole
  centreId: string | null
  centreName: string | null
}

export type UserContext = {
  userId: string
  email: string
  fullName: string
  isSuperAdmin: boolean
  projects: ProjectAccess[]
}

type Embedded<T> = T | T[] | null

/** Row shape returned by the memberships query in lib/auth/context.ts. */
export type MembershipRow = {
  role: MembershipRole
  centre_id: string | null
  project: Embedded<{ id: string; code: string; title: string; status: string }>
  centre: Embedded<{ name: string }>
}

function one<T>(value: Embedded<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export function toProjectAccess(rows: MembershipRow[]): ProjectAccess[] {
  return rows
    .flatMap((row) => {
      const project = one(row.project)
      if (!project) return []
      return [
        {
          projectId: project.id,
          code: project.code,
          title: project.title,
          status: project.status,
          role: row.role,
          centreId: row.centre_id,
          centreName: one(row.centre)?.name ?? null,
        },
      ]
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Project entry point. It sends each user on to their admin or centre workspace. */
export function projectDashboardPath(code: string) {
  return `/p/${encodeURIComponent(code)}`
}

export function projectAdminPath(code: string, page = "") {
  return `${projectDashboardPath(code)}/admin${page ? `/${page}` : ""}`
}

export function projectCentrePath(code: string, page = "") {
  return `${projectDashboardPath(code)}/centre${page ? `/${page}` : ""}`
}

/** The workspace a member's role opens. */
export function projectHomePath(access: Pick<ProjectAccess, "code" | "role">) {
  return access.role === "project_admin" ? projectAdminPath(access.code) : projectCentrePath(access.code)
}

/** Where a user lands after signing in. */
export function resolveHomePath(context: Pick<UserContext, "isSuperAdmin" | "projects">) {
  if (context.isSuperAdmin) return "/super-admin"
  if (context.projects.length === 1) return projectHomePath(context.projects[0])
  return "/projects"
}

export function roleLabel(role: MembershipRole) {
  return role === "project_admin" ? "Project admin" : "Centre user"
}
