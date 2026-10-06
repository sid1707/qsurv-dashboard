import type { SupabaseClient } from "@supabase/supabase-js"
import { loadUserContext } from "@/lib/auth/context"
import { parseDisplayDateToYmd } from "@/lib/format"
import type { CentreFileIdentity } from "@/lib/validation/filename"
import { loadProject, type ProjectRecord } from "@/lib/projects/context"
import { projectInstruments, type InstrumentId } from "@/lib/qpcr/instruments"
import { createClient } from "@/lib/supabase/server"
import type { CentreAuthFailureReason } from "@/lib/upload/api"

export type CentreUploadContext = {
  userId: string
  project: ProjectRecord
  centre: { id: string; name: string; active: boolean; code: string | null; file_code: string }
  instruments: InstrumentId[]
  supabase: SupabaseClient
}

export type CentreUploadAuth = { ok: true; context: CentreUploadContext } | { ok: false; reason: CentreAuthFailureReason }

export function centreIdentity(centre: { code: string | null; file_code: string }): CentreFileIdentity {
  return { centreId: centre.code, fileCode: centre.file_code }
}

/** Collection dates from the form (DD/MM/YYYY or ISO) as distinct ISO dates; null if any is invalid. */
export function parseSampleDates(values: unknown[]): string[] | null {
  const raw = values.map((v) => String(v ?? "").trim()).filter(Boolean)
  const dates = raw.map((v) => parseDisplayDateToYmd(v))
  if (dates.length === 0 || dates.some((d) => d === null)) return null
  return [...new Set(dates as string[])]
}

/**
 * The signed-in centre user of a project, for the upload API. Server-side
 * replacement for the AMR app's getVrdlContextOrReason: the project comes from
 * the request, the centre from the user's membership (never from the request).
 */
export async function getCentreUploadContext(
  projectCode: unknown,
  options: { requireActiveCentre: boolean }
): Promise<CentreUploadAuth> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: "no_session" }
  if (typeof projectCode !== "string" || !projectCode) return { ok: false, reason: "not_centre_user" }

  const userContext = await loadUserContext(supabase, user)
  const membership = userContext?.projects.find((p) => p.code === projectCode)
  if (!membership || membership.role !== "centre_user" || !membership.centreId) {
    return { ok: false, reason: "not_centre_user" }
  }

  const [project, centre] = await Promise.all([
    loadProject(supabase, projectCode),
    supabase.from("centres").select("id, name, active, code, file_code").eq("id", membership.centreId).maybeSingle(),
  ])
  if (!project || !centre.data) return { ok: false, reason: "not_centre_user" }
  if (!project.data_management) return { ok: false, reason: "feature_off" }
  if (options.requireActiveCentre && !centre.data.active) return { ok: false, reason: "centre_inactive" }
  // File names start with the centre ID, so nothing can be named correctly without one.
  if (options.requireActiveCentre && !centre.data.code) return { ok: false, reason: "centre_id_missing" }

  return {
    ok: true,
    context: { userId: user.id, project, centre: centre.data, instruments: projectInstruments(project), supabase },
  }
}
