"use server"

import { redirect } from "next/navigation"
import { resolveHomePath } from "@/lib/auth/access"
import { loadUserContext } from "@/lib/auth/context"
import { createClient } from "@/lib/supabase/server"

type ActionState = {
  status: "idle" | "success" | "error"
  message?: string
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export async function signInWithPasswordAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""))
  const password = String(formData.get("password") ?? "")
  if (!email || !password) {
    return { status: "error", message: "Email and password are required." }
  }

  const supabase = await createClient()
  const { error: signError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (signError) {
    // Project request accounts stay banned until a super admin approves the project.
    if (signError.code === "user_banned") {
      return {
        status: "error",
        message: "Your account is waiting for approval. You can sign in once the QSurv team approves your project.",
      }
    }
    const msg =
      signError.message === "Invalid login credentials"
        ? "Invalid email or password."
        : `Sign-in failed: ${signError.message}`
    return { status: "error", message: msg }
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    await supabase.auth.signOut()
    return { status: "error", message: "Could not load session after sign-in." }
  }

  const context = await loadUserContext(supabase, user)
  if (!context) {
    await supabase.auth.signOut()
    return {
      status: "error",
      message: "Your account has no profile yet. Contact the QSurv administrator.",
    }
  }

  redirect(resolveHomePath(context))
}
