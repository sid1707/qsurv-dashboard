import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { MembershipRole } from "@/lib/auth/access"
import { dbErrorMessage } from "@/lib/project-admin/result"
import { seatSummary } from "@/lib/project-admin/user-limits"

export type ProjectMember = {
  membershipId: string
  userId: string
  fullName: string
  email: string
  role: MembershipRole
  centreId: string | null
  centreName: string | null
  addedAt: string
  /** Invited by email and has not signed in yet. */
  invitePending: boolean
  lastSignInAt: string | null
}

type DirectoryRow = {
  membership_id: string
  user_id: string
  full_name: string
  email: string
  role: MembershipRole
  centre_id: string | null
  centre_name: string | null
  added_at: string
  invited_at: string | null
  last_sign_in_at: string | null
}

export async function listMembers(supabase: SupabaseClient, projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase.rpc("project_member_directory", { p_project_id: projectId })
  if (error) throw new Error(`Could not load project users: ${error.message}`)
  return ((data ?? []) as DirectoryRow[]).map((r) => ({
    membershipId: r.membership_id,
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    centreId: r.centre_id,
    centreName: r.centre_name,
    addedAt: r.added_at,
    invitePending: r.invited_at !== null && r.last_sign_in_at === null,
    lastSignInAt: r.last_sign_in_at,
  }))
}

export async function countMembers(supabase: SupabaseClient, projectId: string) {
  const { count, error } = await supabase
    .from("project_memberships")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  if (error) throw new Error(`Could not count project users: ${error.message}`)
  return count ?? 0
}

// ---------- Input ----------

const roleFields = {
  role: z.enum(["project_admin", "centre_user"], { error: "Choose a role." }),
  centreId: z.string().trim().transform((v) => v || null),
}

/** Centre users need a centre; project admins must not have one (as the database requires). */
function checkCentre(v: { role: MembershipRole; centreId: string | null }, ctx: z.RefinementCtx) {
  if (v.role === "centre_user" && !v.centreId) {
    ctx.addIssue({ code: "custom", path: ["centreId"], message: "Choose the user's centre." })
  } else if (v.role === "centre_user" && !z.uuid().safeParse(v.centreId).success) {
    ctx.addIssue({ code: "custom", path: ["centreId"], message: "Invalid centre." })
  }
}

export const inviteInput = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
    fullName: z.string().trim().min(1, "Enter the user's name.").max(120, "The name must be 120 characters or fewer."),
    ...roleFields,
  })
  .superRefine(checkCentre)
  .transform((v) => ({ ...v, centreId: v.role === "project_admin" ? null : v.centreId }))

export const roleInput = z
  .object({ membershipId: z.uuid("Invalid user."), ...roleFields })
  .superRefine(checkCentre)
  .transform((v) => ({ ...v, centreId: v.role === "project_admin" ? null : v.centreId }))

export type InviteInput = z.output<typeof inviteInput>

const DUPLICATE_MEMBER = "This person is already a member of this project."

async function activeCentre(supabase: SupabaseClient, projectId: string, centreId: string | null) {
  if (!centreId) return true
  const { data } = await supabase
    .from("centres")
    .select("id")
    .eq("id", centreId)
    .eq("project_id", projectId)
    .eq("active", true)
    .maybeSingle()
  return Boolean(data)
}

// ---------- Invite ----------

/** The service-role auth API, injected so tests can stand in for it. */
export type InviteAdmin = {
  findUserIdByEmail(email: string): Promise<string | null>
  inviteByEmail(
    email: string,
    options: { fullName: string; redirectTo: string }
  ): Promise<{ userId: string } | { error: string }>
  deleteUser(userId: string): Promise<void>
}

export type InviteResult =
  | { ok: true; userId: string; invited: boolean; message: string }
  | { ok: false; message: string }

/**
 * Adds someone to the project. A new email gets a Supabase invite link; an
 * existing QSurv account (e.g. from another project) is added straight away.
 * The membership is inserted with the admin's own client, so RLS and the tier
 * limit trigger still apply. The seat check before the invite stops the email
 * going out to someone who could not then be added.
 */
export async function inviteMember(
  deps: { supabase: SupabaseClient; admin: InviteAdmin | null; projectId: string; userTier: string | null; redirectTo: string },
  raw: unknown
): Promise<InviteResult> {
  const parsed = inviteInput.safeParse(raw)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }
  const input = parsed.data
  const { supabase, admin, projectId } = deps

  if (!admin) {
    return { ok: false, message: "Invites are not set up on this server (SUPABASE_SERVICE_ROLE_KEY is missing)." }
  }
  if (!(await activeCentre(supabase, projectId, input.centreId))) {
    return { ok: false, message: "Choose an active centre in this project." }
  }

  const seats = seatSummary(await countMembers(supabase, projectId), deps.userTier)
  if (seats.full) {
    return {
      ok: false,
      message: `This project has reached its limit of ${seats.limit} users. Remove a user first, or ask the QSurv team to raise the limit.`,
    }
  }

  const existingId = await admin.findUserIdByEmail(input.email)
  let userId = existingId
  if (!userId) {
    const invited = await admin.inviteByEmail(input.email, { fullName: input.fullName, redirectTo: deps.redirectTo })
    if ("error" in invited) return { ok: false, message: `The invite could not be sent: ${invited.error}` }
    userId = invited.userId
  }

  const { error } = await supabase.from("project_memberships").insert({
    user_id: userId,
    project_id: projectId,
    centre_id: input.centreId,
    role: input.role,
  })
  if (error) {
    // Do not leave behind an account we just created and cannot give access to.
    if (!existingId) await admin.deleteUser(userId)
    return { ok: false, message: dbErrorMessage(error, DUPLICATE_MEMBER) }
  }

  return existingId
    ? { ok: true, userId, invited: false, message: `${input.email} already has a QSurv account and was added to the project.` }
    : { ok: true, userId, invited: true, message: `Invite sent to ${input.email}.` }
}

// ---------- Change role / remove ----------

type MemberResult = { ok: true; userId: string } | { ok: false; message: string }

export async function changeMemberRole(supabase: SupabaseClient, projectId: string, raw: unknown): Promise<MemberResult> {
  const parsed = roleInput.safeParse(raw)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }
  const { membershipId, role, centreId } = parsed.data
  if (!(await activeCentre(supabase, projectId, centreId))) {
    return { ok: false, message: "Choose an active centre in this project." }
  }

  const { data, error } = await supabase
    .from("project_memberships")
    .update({ role, centre_id: centreId })
    .eq("id", membershipId)
    .eq("project_id", projectId)
    .select("user_id")
    .maybeSingle()
  if (error) return { ok: false, message: dbErrorMessage(error) }
  if (!data) return { ok: false, message: "User not found in this project." }
  return { ok: true, userId: data.user_id }
}

/** Removes the membership only. The account stays, since it may belong to other projects. */
export async function removeMember(supabase: SupabaseClient, projectId: string, membershipId: string): Promise<MemberResult> {
  if (!z.uuid().safeParse(membershipId).success) return { ok: false, message: "Invalid user." }
  const { data, error } = await supabase
    .from("project_memberships")
    .delete()
    .eq("id", membershipId)
    .eq("project_id", projectId)
    .select("user_id")
    .maybeSingle()
  if (error) return { ok: false, message: dbErrorMessage(error) }
  if (!data) return { ok: false, message: "User not found in this project." }
  return { ok: true, userId: data.user_id }
}
