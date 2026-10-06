import { redirect } from "next/navigation"
import { projectDashboardPath } from "@/lib/auth/access"

/** Old project URL. Projects now live under /p/[code]. */
export default async function LegacyProjectPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  redirect(projectDashboardPath(code))
}
