import { redirect } from "next/navigation"
import { projectCentrePath } from "@/lib/auth/access"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES, visiblePages } from "@/lib/projects/features"

/** Opens the first page the project's features allow (Upload when data management is on). */
export default async function CentreHomePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, features } = await requireCentreUser(code)
  redirect(projectCentrePath(project.code, visiblePages(CENTRE_PAGES, features)[0].page))
}
