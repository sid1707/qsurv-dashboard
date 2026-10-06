import type { SupabaseClient } from "@supabase/supabase-js"
import { countMembers } from "@/lib/project-admin/users"
import { seatSummary, type Seats } from "@/lib/project-admin/user-limits"

export type CentreActivity = {
  centreId: string
  centreName: string
  active: boolean
  users: number
  uploadsThisMonth: number
  pendingApprovals: number
  lastUploadAt: string | null
}

export type ProjectOverview = {
  centres: { active: number; total: number }
  seats: Seats
  uploadsThisMonth: number
  pendingApprovals: number
  activity: CentreActivity[]
}

type ActivityRow = {
  centre_id: string
  centre_name: string
  active: boolean
  users: number
  uploads_this_month: number
  pending_approvals: number
  last_upload_at: string | null
}

export function summariseOverview(rows: ActivityRow[], memberCount: number, userTier: string | null): ProjectOverview {
  const activity = rows.map((r) => ({
    centreId: r.centre_id,
    centreName: r.centre_name,
    active: r.active,
    users: r.users,
    uploadsThisMonth: r.uploads_this_month,
    pendingApprovals: r.pending_approvals,
    lastUploadAt: r.last_upload_at,
  }))
  const sum = (key: "uploadsThisMonth" | "pendingApprovals") => activity.reduce((n, c) => n + c[key], 0)
  return {
    centres: { active: activity.filter((c) => c.active).length, total: activity.length },
    seats: seatSummary(memberCount, userTier),
    uploadsThisMonth: sum("uploadsThisMonth"),
    pendingApprovals: sum("pendingApprovals"),
    activity,
  }
}

export async function loadOverview(supabase: SupabaseClient, projectId: string, userTier: string | null) {
  const [activity, members] = await Promise.all([
    supabase.rpc("project_centre_activity", { p_project_id: projectId }),
    countMembers(supabase, projectId),
  ])
  if (activity.error) throw new Error(`Could not load centre activity: ${activity.error.message}`)
  return summariseOverview((activity.data ?? []) as ActivityRow[], members, userTier)
}
