"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { parseAnnouncementId } from "@/lib/announcements/schema"
import { setAnnouncementDismissed } from "@/lib/announcements/queries"
import { projectCentrePath } from "@/lib/auth/access"
import { requireUserContext } from "@/lib/auth/context"
import { newPasswordInput } from "@/lib/auth/invite"
import { dbErrorMessage, fail, ok, type ActionState } from "@/lib/project-admin/result"
import { UPLOAD_BUCKET, uploadFolder } from "@/lib/upload/path"
import { canDeleteUpload } from "@/lib/upload/status"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

const NOT_ALLOWED = "Only centre users of this project can do this."

/** The signed-in user's centre membership in this project, or null. */
async function centreSession(code: string) {
  const user = await requireUserContext()
  const membership = user.projects.find((p) => p.code === code && p.role === "centre_user" && p.centreId)
  if (!membership) return null
  return { user, membership: membership as typeof membership & { centreId: string }, supabase: await createClient() }
}

export async function setAnnouncementDismissedAction(code: string, announcementId: string, dismissed: boolean): Promise<ActionState> {
  const session = await centreSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const id = parseAnnouncementId(announcementId)
  if (!id) return fail("Announcement is invalid.")

  const result = await setAnnouncementDismissed(session.supabase, session.user.userId, id, dismissed)
  if (!result.ok) return fail(result.message)
  revalidatePath(projectCentrePath(code), "layout")
  return ok(dismissed ? "Announcement dismissed." : "Announcement marked unread.")
}

/**
 * Deletes one of the user's own uploads while it awaits approval (AMR rule:
 * centre users may only delete their own pending uploads). RLS enforces the
 * same; the stored files are removed with the service role.
 */
export async function deleteUploadAction(code: string, uploadId: string): Promise<ActionState> {
  const session = await centreSession(code)
  if (!session) return fail(NOT_ALLOWED)
  if (!z.uuid().safeParse(uploadId).success) return fail("Invalid upload.")
  const { supabase, membership, user } = session

  const { data: batch } = await supabase
    .from("upload_batches")
    .select("id, upload_status, processing_status, approval_status")
    .eq("id", uploadId)
    .eq("project_id", membership.projectId)
    .eq("centre_id", membership.centreId)
    .eq("uploaded_by", user.userId)
    .maybeSingle()
  if (!batch) return fail("Upload not found, or it was uploaded by someone else.")
  if (!canDeleteUpload(batch)) return fail("Approved or rejected uploads cannot be deleted.")

  const service = createServiceRoleClient()
  if (service) {
    const folders = (["results", "runfile", "splits"] as const).map((kind) => uploadFolder(code, membership.centreId, uploadId, kind))
    const listed = await Promise.all(folders.map((f) => service.storage.from(UPLOAD_BUCKET).list(f.slice(0, -1))))
    const paths = listed.flatMap((res, i) => (res.data ?? []).map((o) => `${folders[i]}${o.name}`))
    if (paths.length > 0) {
      const { error } = await service.storage.from(UPLOAD_BUCKET).remove(paths)
      if (error) console.error(`Stored files for upload ${uploadId} were not removed: ${error.message}`)
    }
  } else {
    console.error(`SUPABASE_SERVICE_ROLE_KEY missing: stored files for upload ${uploadId} were left in storage.`)
  }

  const { error } = await supabase.from("upload_batches").delete().eq("id", uploadId)
  if (error) return fail(dbErrorMessage(error))
  revalidatePath(projectCentrePath(code), "layout")
  return ok("Upload deleted.")
}

const profileInput = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120, "Your name must be 120 characters or fewer."),
  phone: z
    .string()
    .trim()
    .max(30, "The phone number must be 30 characters or fewer.")
    .refine((v) => v === "" || /^[+0-9 ()-]{6,}$/.test(v), "Enter a valid phone number or leave it blank.")
    .transform((v) => v || null),
})

export async function updateProfileAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await centreSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const parsed = profileInput.safeParse({ fullName: formData.get("fullName") ?? "", phone: formData.get("phone") ?? "" })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { error } = await session.supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone })
    .eq("user_id", session.user.userId)
  if (error) return fail(dbErrorMessage(error))
  revalidatePath("/", "layout")
  return ok("Profile saved.")
}

/** The password goes only to Supabase Auth. */
export async function changePasswordAction(code: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await centreSession(code)
  if (!session) return fail(NOT_ALLOWED)
  const parsed = newPasswordInput.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  })
  if (!parsed.success) return fail(parsed.error.issues[0].message)

  const { error } = await session.supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return fail(`The password could not be changed: ${error.message}`)
  return ok("Password changed.")
}
