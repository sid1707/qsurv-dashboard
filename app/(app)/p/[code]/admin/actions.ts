"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { parseAnnouncementId, parseCreateAnnouncementInput } from "@/lib/announcements/schema"
import { createAnnouncement, setAnnouncementArchived } from "@/lib/announcements/queries"
import { projectAdminPath, projectCentrePath } from "@/lib/auth/access"
import { getProjectAdminContext } from "@/lib/projects/context"
import { assignCentreId, createCentre, parseCentreForm, setCentreActive, updateCentre } from "@/lib/project-admin/centres"
import { createInviteAdmin } from "@/lib/project-admin/invite-admin"
import { fail, ok, recordAudit, type ActionState } from "@/lib/project-admin/result"
import { changeProjectKit, parseDetailsForm, updateProjectDetails } from "@/lib/project-admin/settings"
import { changeMemberRole, inviteMember, removeMember } from "@/lib/project-admin/users"
import { createClient } from "@/lib/supabase/server"

const NOT_ALLOWED = "Only a project admin of this project can do this."

/** Every action re-checks access. RLS and the database functions check again. */
async function adminSession(code: string) {
  const context = await getProjectAdminContext(code)
  if (!context) return null
  const supabase = await createClient()
  const audit = (event: { eventType: string; entityType: string; entityId: string; payload?: Record<string, unknown> }) =>
    recordAudit(supabase, {
      ...event,
      projectId: context.project.id,
      actorId: context.user.userId,
      actorRole: context.membership?.role ?? "super_admin",
    })
  return { context, supabase, audit }
}

function refresh(code: string) {
  revalidatePath(projectAdminPath(code), "layout")
}

function firstIssue(error: { issues: { message: string }[] }) {
  return fail(error.issues[0]?.message ?? "Check the form and try again.")
}

// ---------- Centres ----------

export async function createCentreAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const parsed = parseCentreForm(formData)
  if (!parsed.success) return firstIssue(parsed.error)

  const result = await createCentre(session.supabase, session.context.project.id, parsed.data)
  if (!result.ok) return fail(result.message)
  await session.audit({ eventType: "centre.created", entityType: "centre", entityId: result.id, payload: { name: result.name } })
  refresh(code)
  return ok(`${result.name} added.`)
}

export async function updateCentreAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const parsed = parseCentreForm(formData)
  if (!parsed.success) return firstIssue(parsed.error)

  const centreId = String(formData.get("centreId") ?? "")
  const result = await updateCentre(session.supabase, session.context.project.id, centreId, parsed.data)
  if (!result.ok) return fail(result.message)
  await session.audit({ eventType: "centre.updated", entityType: "centre", entityId: result.id, payload: parsed.data })
  refresh(code)
  return ok(`${result.name} saved.`)
}

export async function setCentreActiveAction(code: string, centreId: string, active: boolean): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)

  const result = await setCentreActive(session.supabase, session.context.project.id, centreId, active)
  if (!result.ok) return fail(result.message)
  await session.audit({
    eventType: active ? "centre.reactivated" : "centre.deactivated",
    entityType: "centre",
    entityId: result.id,
  })
  refresh(code)
  return ok(`${result.name} ${active ? "reactivated" : "deactivated"}.`)
}

// ---------- Users ----------

/** Where invite links send people back to. Supabase only accepts URLs on its redirect allow list. */
async function siteOrigin() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "")
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https")
  return `${proto}://${host}`
}

export async function inviteUserAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const { project } = session.context

  // A centre gets its ID (the start of its file names) when its first users are added.
  const centreId = String(formData.get("centreId") ?? "")
  if (formData.get("role") === "centre_user" && formData.has("centreCode")) {
    const assigned = await assignCentreId(session.supabase, project.id, centreId, formData.get("centreCode"))
    if (!assigned.ok) return fail(assigned.message)
    await session.audit({ eventType: "centre.id_assigned", entityType: "centre", entityId: centreId, payload: { code: assigned.code } })
  }

  const next = encodeURIComponent(`/p/${encodeURIComponent(project.code)}`)
  const result = await inviteMember(
    {
      supabase: session.supabase,
      admin: createInviteAdmin(),
      projectId: project.id,
      userTier: project.user_tier,
      redirectTo: `${await siteOrigin()}/auth/accept?next=${next}`,
    },
    {
      email: formData.get("email") ?? "",
      fullName: formData.get("fullName") ?? "",
      role: formData.get("role") ?? "",
      centreId: formData.get("centreId") ?? "",
    }
  )
  if (!result.ok) return fail(result.message)
  // The membership itself is audited by the database (membership.added); this
  // records the one thing it cannot see, that an invite email went out.
  if (result.invited) {
    await session.audit({
      eventType: "user.invited",
      entityType: "user",
      entityId: result.userId,
      payload: { role: formData.get("role"), centre_id: formData.get("centreId") || null },
    })
  }
  refresh(code)
  return ok(result.message)
}

export async function changeRoleAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)

  const result = await changeMemberRole(session.supabase, session.context.project.id, {
    membershipId: formData.get("membershipId") ?? "",
    role: formData.get("role") ?? "",
    centreId: formData.get("centreId") ?? "",
  })
  // Audited by the database (membership.role_changed, with the old and new role).
  if (!result.ok) return fail(result.message)
  refresh(code)
  // An admin who made themselves a centre user no longer has this dashboard.
  if (result.userId === session.context.user.userId && formData.get("role") === "centre_user") {
    redirect(projectCentrePath(code))
  }
  return ok("Role updated.")
}

export async function removeUserAction(code: string, membershipId: string): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)

  const result = await removeMember(session.supabase, session.context.project.id, membershipId)
  // Audited by the database (membership.removed).
  if (!result.ok) return fail(result.message)
  refresh(code)
  if (result.userId === session.context.user.userId) redirect("/projects")
  return ok("User removed from the project.")
}

// ---------- Announcements ----------

export type AnnouncementActionState = ActionState & { announcementId?: string }

export async function createAnnouncementAction(
  code: string,
  _prev: AnnouncementActionState,
  formData: FormData
): Promise<AnnouncementActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)

  const parsed = parseCreateAnnouncementInput({
    title: formData.get("title"),
    body: formData.get("body"),
    audience: formData.get("audience"),
    centreIds: formData.getAll("centreIds"),
  })
  if (!parsed.ok) return fail(parsed.message)

  const result = await createAnnouncement(session.supabase, session.context.project.id, parsed.data)
  if (!result.ok) return fail(result.message)
  await session.audit({ eventType: "announcement.published", entityType: "announcement", entityId: result.id })
  refresh(code)
  return { status: "success", message: "Announcement published.", announcementId: result.id }
}

export async function setAnnouncementArchivedAction(
  code: string,
  announcementId: string,
  archived: boolean
): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const id = parseAnnouncementId(announcementId)
  if (!id) return fail("Announcement is invalid.")

  const result = await setAnnouncementArchived(session.supabase, session.context.project.id, id, archived)
  if (!result.ok) return fail(result.message)
  await session.audit({
    eventType: archived ? "announcement.archived" : "announcement.restored",
    entityType: "announcement",
    entityId: id,
  })
  refresh(code)
  return ok(archived ? "Announcement archived." : "Announcement restored.")
}

// ---------- Settings ----------

export async function updateDetailsAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const parsed = parseDetailsForm(formData)
  if (!parsed.success) return firstIssue(parsed.error)

  // Audited by the database function.
  const result = await updateProjectDetails(session.supabase, session.context.project.id, parsed.data)
  if (!result.ok) return fail(result.message)
  refresh(code)
  return ok("Project details saved.")
}

export async function changeKitAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await adminSession(code)
  if (!session) return fail(NOT_ALLOWED)

  const result = await changeProjectKit(session.supabase, session.context.project, formData.get("kitId"))
  if (!result.ok) return fail(result.message)
  refresh(code)
  return ok("Kit changed. The plate layout and data rules were reset to the new kit's defaults.")
}
