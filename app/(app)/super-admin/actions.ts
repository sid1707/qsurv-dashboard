"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireUserContext } from "@/lib/auth/context"
import { saveKit, type SaveKitResult } from "@/lib/kits/admin"
import { approveRequest, rejectRequest, type ReviewState } from "@/lib/super-admin/requests"
import { createClient } from "@/lib/supabase/server"

const NOT_ALLOWED = "Only a super admin can do this."

// The database functions check is_super_admin again; this check gives a clear
// message early and keeps non-admins from reaching them at all.
async function superAdminClient() {
  const context = await requireUserContext()
  return context.isSuperAdmin ? createClient() : null
}

export async function approveRequestAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const supabase = await superAdminClient()
  if (!supabase) return { status: "error", message: NOT_ALLOWED }

  const result = await approveRequest(supabase, {
    requestId: formData.get("requestId"),
    note: String(formData.get("note") ?? ""),
  })
  if (!result.ok) return { status: "error", message: result.message }

  revalidatePath("/super-admin", "layout")
  redirect(`/super-admin?approved=${encodeURIComponent(result.reference)}&project=${encodeURIComponent(result.projectCode)}`)
}

export async function rejectRequestAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const supabase = await superAdminClient()
  if (!supabase) return { status: "error", message: NOT_ALLOWED }

  const result = await rejectRequest(supabase, {
    requestId: formData.get("requestId"),
    reason: String(formData.get("reason") ?? ""),
  })
  if (!result.ok) return { status: "error", message: result.message }

  revalidatePath("/super-admin", "layout")
  redirect(`/super-admin?rejected=${encodeURIComponent(result.reference)}`)
}

export async function saveKitAction(values: unknown): Promise<SaveKitResult> {
  const supabase = await superAdminClient()
  if (!supabase) return { ok: false, message: NOT_ALLOWED }

  const result = await saveKit(supabase, values)
  if (result.ok) {
    revalidatePath("/super-admin/kits", "layout")
    revalidatePath("/")
    revalidatePath("/onboarding")
  }
  // The editor navigates back to the kit list on success.
  return result
}
