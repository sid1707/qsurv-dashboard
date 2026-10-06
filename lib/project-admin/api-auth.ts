import { NextResponse } from "next/server"
import { getUserContext } from "@/lib/auth/context"
import { getProjectAdminContext, type ProjectAdminContext } from "@/lib/projects/context"
import type { ProjectFeature } from "@/lib/projects/features"

export type ProjectAdminApiAuth = { ok: true; context: ProjectAdminContext } | { ok: false; response: NextResponse }

const deny = (status: number, message: string) => ({ ok: false as const, response: NextResponse.json({ message }, { status }) })

/**
 * The project admin (or super admin) for an API route, from
 * vrdl-next-platform's requireAdminContext but scoped to one project. Answers
 * with JSON instead of redirecting, and refuses when the feature is off.
 */
export async function requireProjectAdminApi(code: string, feature: ProjectFeature): Promise<ProjectAdminApiAuth> {
  if (!(await getUserContext())) return deny(401, "Your session expired. Sign in again and retry.")
  const context = await getProjectAdminContext(code)
  if (!context) return deny(403, "Only this project's admins can do this.")
  if (!context.features[feature]) return deny(403, "This feature is not switched on for the project.")
  return { ok: true, context }
}
