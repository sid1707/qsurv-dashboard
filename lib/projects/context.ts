import { cache } from "react"
import { notFound, redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import { projectAdminPath, projectCentrePath, type ProjectAccess, type UserContext } from "@/lib/auth/access"
import { requireUserContext } from "@/lib/auth/context"
import type { PlateLayout } from "@/lib/plate/layout"
import { featuresOf, isPageEnabled, type ProjectFeatures, type WorkspacePage } from "@/lib/projects/features"
import type { RuleSettings } from "@/lib/rules/catalog"
import { createClient } from "@/lib/supabase/server"

export type ProjectRecord = ProjectFeatures & {
  id: string
  code: string
  title: string
  status: string
  objective: string | null
  funding_agency: string | null
  ethics_reference: string | null
  start_date: string | null
  end_date: string | null
  sample_type: string
  sample_type_other: string | null
  frequency: string
  kit_id: string
  instrument: string | null
  instruments: string[] | null
  instrument_other: string | null
  user_tier: string | null
  plate_layout: PlateLayout | null
  qc_rules: RuleSettings | null
  compile_rules: RuleSettings | null
}

const PROJECT_COLUMNS =
  "id, code, title, status, objective, funding_agency, ethics_reference, start_date, end_date, sample_type, sample_type_other, frequency, kit_id, instrument, instruments, instrument_other, user_tier, data_management, data_compilation, data_plotting, plate_layout, qc_rules, compile_rules"

/** RLS returns a project only to its members and super admins. */
export async function loadProject(supabase: SupabaseClient, code: string): Promise<ProjectRecord | null> {
  const { data, error } = await supabase.from("projects").select(PROJECT_COLUMNS).eq("code", code).maybeSingle()
  if (error) throw new Error(`Could not load the project: ${error.message}`)
  return (data as ProjectRecord | null) ?? null
}

export type ProjectAdminContext = {
  user: UserContext
  project: ProjectRecord
  features: ProjectFeatures
  /** Null for a super admin who is not a member of the project. */
  membership: ProjectAccess | null
}

/** Super admins can manage every project, as the database's can_manage_project allows. */
export function canManage(user: Pick<UserContext, "isSuperAdmin">, membership: ProjectAccess | null) {
  return user.isSuperAdmin || membership?.role === "project_admin"
}

/**
 * Loads the project for a project admin (or super admin). Returns null for
 * anyone else, so server actions can answer with a message instead of a redirect.
 */
export async function getProjectAdminContext(code: string): Promise<ProjectAdminContext | null> {
  const user = await requireUserContext()
  const membership = user.projects.find((p) => p.code === code) ?? null
  if (!canManage(user, membership)) return null
  const project = await loadProject(await createClient(), code)
  if (!project) return null
  return { user, project, features: featuresOf(project), membership }
}

const cachedAdminContext = cache(getProjectAdminContext)

export type CentreUserContext = {
  user: UserContext
  project: ProjectRecord
  features: ProjectFeatures
  membership: ProjectAccess
  centre: { id: string; name: string; active: boolean; code: string | null; file_code: string }
}

const cachedCentreContext = cache(async (code: string): Promise<CentreUserContext | "admin" | null> => {
  const user = await requireUserContext()
  const membership = user.projects.find((p) => p.code === code) ?? null
  if (canManage(user, membership)) return "admin"
  if (!membership?.centreId) return null
  const supabase = await createClient()
  const [project, centre] = await Promise.all([
    loadProject(supabase, code),
    supabase.from("centres").select("id, name, active, code, file_code").eq("id", membership.centreId).maybeSingle(),
  ])
  if (!project || !centre.data) return null
  return { user, project, features: featuresOf(project), membership, centre: centre.data }
})

/** For centre pages: sends admins to the admin dashboard and hides the project from everyone else. */
export async function requireCentreUser(code: string, page?: { pages: WorkspacePage[]; page: string }) {
  const context = await cachedCentreContext(code)
  if (context === "admin") redirect(projectAdminPath(code))
  if (!context) notFound()
  if (page && !isPageEnabled(page.pages, page.page, context.features)) notFound()
  return context
}

/** For admin pages: sends centre users to their workspace and hides the project from everyone else. */
export async function requireProjectAdmin(code: string, page?: { pages: WorkspacePage[]; page: string }) {
  const context = await cachedAdminContext(code)
  if (!context) {
    const user = await requireUserContext()
    if (user.projects.some((p) => p.code === code)) redirect(projectCentrePath(code))
    notFound()
  }
  if (page && !isPageEnabled(page.pages, page.page, context.features)) notFound()
  return context
}
