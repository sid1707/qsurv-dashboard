import { cache } from "react"
import { redirect } from "next/navigation"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { toProjectAccess, type MembershipRow, type UserContext } from "@/lib/auth/access"
import { createClient } from "@/lib/supabase/server"

/** Loads the signed-in user's profile and project memberships (RLS-scoped). */
export async function loadUserContext(
  supabase: SupabaseClient,
  user: Pick<User, "id" | "email">
): Promise<UserContext | null> {
  const [profileResult, membershipResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, is_super_admin")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("project_memberships")
      .select("role, centre_id, project:projects(id, code, title, status), centre:centres(name)")
      .eq("user_id", user.id),
  ])

  if (profileResult.error || !profileResult.data || membershipResult.error) {
    return null
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profileResult.data.full_name,
    isSuperAdmin: profileResult.data.is_super_admin,
    projects: toProjectAccess((membershipResult.data ?? []) as MembershipRow[]),
  }
}

/** Per-request cached, so layouts and pages can both call it. */
export const getUserContext = cache(async (): Promise<UserContext | null> => {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null
  return loadUserContext(supabase, user)
})

export async function requireUserContext(): Promise<UserContext> {
  const context = await getUserContext()
  if (!context) redirect("/login")
  return context
}
