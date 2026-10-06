"use server"

import { redirect } from "next/navigation"
import { newPasswordInput, safeNextPath } from "@/lib/auth/invite"
import { createClient } from "@/lib/supabase/server"

export type SetPasswordState = { status: "idle" | "error"; message?: string }

/** The password goes only to Supabase Auth. */
export async function setPasswordAction(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const parsed = newPasswordInput.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  })
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Your invite session has expired. Open the invite link again." }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { status: "error", message: `The password could not be saved: ${error.message}` }

  redirect(safeNextPath(String(formData.get("next") ?? "")))
}
