import { Panel } from "@/components/project-admin/form"
import { InviteUserForm, MemberList } from "@/components/project-admin/users-manager"
import { userTierLabel } from "@/lib/onboarding/labels"
import { listCentres } from "@/lib/project-admin/centres"
import { seatSummary } from "@/lib/project-admin/user-limits"
import { listMembers } from "@/lib/project-admin/users"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function UsersPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, user } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "users" })
  const supabase = await createClient()
  const [members, centres] = await Promise.all([listMembers(supabase, project.id), listCentres(supabase, project.id)])
  const seats = seatSummary(members.length, project.user_tier)
  const activeCentres = centres
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name, code: c.code, fileCode: c.file_code }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Users</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {seats.limit === null
            ? `${seats.used} user${seats.used === 1 ? "" : "s"}. This project has no user limit.`
            : `${seats.used} of ${seats.limit} users (${userTierLabel(project.user_tier)}, chosen at onboarding).`}
        </p>
      </div>
      <Panel title="Invite a user" description="Centre users see only their own centre's data.">
        {activeCentres.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">
            Add a centre first to invite centre users. You can still add project admins.
          </p>
        ) : null}
        <InviteUserForm code={project.code} centres={activeCentres} seats={seats} />
      </Panel>
      <Panel title={`Project users (${members.length})`} description="A project always keeps at least one project admin.">
        <MemberList code={project.code} members={members} centres={activeCentres} currentUserId={user.userId} />
      </Panel>
    </div>
  )
}
