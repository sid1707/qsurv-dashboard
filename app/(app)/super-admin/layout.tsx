import { redirect } from "next/navigation"
import { SuperAdminNav } from "@/components/super-admin/super-admin-nav"
import { resolveHomePath } from "@/lib/auth/access"
import { requireUserContext } from "@/lib/auth/context"
import { countPendingRequests } from "@/lib/super-admin/requests"
import { createClient } from "@/lib/supabase/server"

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requireUserContext()
  if (!context.isSuperAdmin) redirect(resolveHomePath(context))

  const pendingCount = await countPendingRequests(await createClient())

  return (
    <div>
      <h1 className="text-2xl font-semibold">Super admin</h1>
      <div className="mt-4">
        <SuperAdminNav pendingCount={pendingCount} />
      </div>
      <div className="mt-6">{children}</div>
    </div>
  )
}
