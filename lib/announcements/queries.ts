import type { SupabaseClient } from "@supabase/supabase-js"
import type { AnnouncementAudience, CreateAnnouncementInput } from "@/lib/announcements/schema"
import { dbErrorMessage } from "@/lib/project-admin/result"

export type AdminAnnouncementRow = {
  id: string
  title: string
  body: string
  audience: AnnouncementAudience
  createdAt: string
  archivedAt: string | null
  centreNames: string[]
}

type CentreEmbed = { name: string }
type AnnouncementCentreEmbed = { centre_id: string; centres: CentreEmbed | CentreEmbed[] | null }

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function listProjectAnnouncements(
  supabase: SupabaseClient,
  projectId: string
): Promise<AdminAnnouncementRow[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, audience, created_at, archived_at, announcement_centres(centre_id, centres(name))")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Could not load announcements: ${error.message}`)

  return (data ?? []).map((row) => {
    const targets = (row.announcement_centres as AnnouncementCentreEmbed[] | null) ?? []
    return {
      id: row.id as string,
      title: row.title as string,
      body: row.body as string,
      audience: row.audience as AnnouncementAudience,
      createdAt: row.created_at as string,
      archivedAt: (row.archived_at as string | null) ?? null,
      centreNames: targets
        .map((t) => asSingle(t.centres)?.name)
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b)),
    }
  })
}

type Result = { ok: true; id: string } | { ok: false; message: string }

/** Inserts the announcement and its centre targets in one transaction. */
export async function createAnnouncement(
  supabase: SupabaseClient,
  projectId: string,
  input: CreateAnnouncementInput
): Promise<Result> {
  const { data, error } = await supabase.rpc("create_announcement", {
    p_project_id: projectId,
    p_title: input.title,
    p_body: input.body,
    p_audience: input.audience,
    p_centre_ids: input.centreIds,
  })
  if (error) return { ok: false, message: dbErrorMessage(error) }
  return { ok: true, id: data as string }
}

/** Archive hides it from every centre; restore brings it back (dismissals stay). */
export async function setAnnouncementArchived(
  supabase: SupabaseClient,
  projectId: string,
  announcementId: string,
  archived: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("announcements")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", announcementId)
    .eq("project_id", projectId)
    .select("id")
    .maybeSingle()
  if (error) return { ok: false, message: dbErrorMessage(error) }
  if (!data) return { ok: false, message: "Announcement not found in this project." }
  return { ok: true }
}

// ---------- Centre users ----------

export type CentreAnnouncement = {
  id: string
  title: string
  body: string
  createdAt: string
  dismissed: boolean
}

/**
 * Live announcements for the signed-in centre user. RLS returns only the
 * project's unarchived announcements addressed to every centre or to theirs.
 * From vrdl-next-platform listUnreadAnnouncementsForUser, keeping dismissed ones
 * so they can be read again.
 */
export async function listCentreAnnouncements(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<CentreAnnouncement[]> {
  const [{ data, error }, dismissals] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, created_at")
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("announcement_dismissals").select("announcement_id").eq("user_id", userId),
  ])
  if (error) throw new Error(`Could not load announcements: ${error.message}`)
  if (dismissals.error) throw new Error(`Could not load announcements: ${dismissals.error.message}`)

  const dismissed = new Set((dismissals.data ?? []).map((d) => d.announcement_id as string))
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    body: row.body as string,
    createdAt: row.created_at as string,
    dismissed: dismissed.has(row.id as string),
  }))
}

export async function setAnnouncementDismissed(
  supabase: SupabaseClient,
  userId: string,
  announcementId: string,
  dismissed: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  // ignoreDuplicates (ON CONFLICT DO NOTHING): dismissals grant insert, not update.
  const { error } = dismissed
    ? await supabase
        .from("announcement_dismissals")
        .upsert({ announcement_id: announcementId, user_id: userId }, { onConflict: "announcement_id,user_id", ignoreDuplicates: true })
    : await supabase.from("announcement_dismissals").delete().eq("announcement_id", announcementId).eq("user_id", userId)
  return error ? { ok: false, message: dbErrorMessage(error) } : { ok: true }
}
