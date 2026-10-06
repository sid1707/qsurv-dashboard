import { notFound, redirect } from "next/navigation"
import { projectAdminPath, projectHomePath } from "@/lib/auth/access"
import { requireUserContext } from "@/lib/auth/context"

/** Sends each member to the workspace for their role. Super admins get the admin view. */
export default async function ProjectEntryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const context = await requireUserContext()
  const membership = context.projects.find((p) => p.code === code)
  if (membership) redirect(projectHomePath(membership))
  if (context.isSuperAdmin) redirect(projectAdminPath(code))
  notFound()
}
