import { E2E_KIT, SUPER_ADMIN, serviceClient } from "./env"

/**
 * Makes sure the local database has what the journey needs: a super admin who
 * can sign in, and an active kit that matches the sample run files.
 */
export default async function globalSetup() {
  const service = serviceClient()

  const { data: list, error: listError } = await service.auth.admin.listUsers({ perPage: 1000 })
  if (listError) throw new Error(`Could not reach Supabase Auth: ${listError.message}`)
  let userId = list.users.find((u) => u.email === SUPER_ADMIN.email)?.id
  if (!userId) {
    const { data, error } = await service.auth.admin.createUser({
      email: SUPER_ADMIN.email,
      password: SUPER_ADMIN.password,
      email_confirm: true,
      user_metadata: { full_name: "E2E Super Admin" },
    })
    if (error) throw new Error(`Could not create the E2E super admin: ${error.message}`)
    userId = data.user.id
  } else {
    await service.auth.admin.updateUserById(userId, { password: SUPER_ADMIN.password, ban_duration: "none" })
  }
  const { error: profileError } = await service.from("profiles").update({ is_super_admin: true }).eq("user_id", userId)
  if (profileError) throw new Error(`Could not make the E2E user a super admin: ${profileError.message}`)

  const { error: kitError } = await service
    .from("kits")
    .update({ active: true })
    .eq("name", E2E_KIT.name)
    .eq("version", E2E_KIT.version)
  if (kitError) throw new Error(`Could not activate the E2E kit: ${kitError.message}`)
}
