import type { InviteAdmin } from "@/lib/project-admin/users"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

/** Service-role auth calls for the invite flow. Null when the key is not configured. Server code only. */
export function createInviteAdmin(): InviteAdmin | null {
  const service = createServiceRoleClient()
  if (!service) return null

  return {
    async findUserIdByEmail(email) {
      const { data, error } = await service.rpc("auth_user_id_by_email", { p_email: email })
      if (error) throw new Error(`Could not look up the email: ${error.message}`)
      return (data as string | null) ?? null
    },
    async inviteByEmail(email, { fullName, redirectTo }) {
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
        // Read by the profile trigger to fill profiles.full_name.
        data: { full_name: fullName },
        redirectTo,
      })
      if (error || !data.user) return { error: error?.message ?? "No user was created." }
      return { userId: data.user.id }
    },
    async deleteUser(userId) {
      const { error } = await service.auth.admin.deleteUser(userId)
      if (error) console.error(`Could not clean up invited user ${userId}: ${error.message}`)
    },
  }
}
