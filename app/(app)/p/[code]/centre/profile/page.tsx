import { ChangePasswordForm, ProfileForm } from "@/components/centre/centre-actions"
import { Panel } from "@/components/project-admin/form"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function ProfilePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, centre, user } = await requireCentreUser(code, { pages: CENTRE_PAGES, page: "profile" })
  const { data: profile } = await (await createClient())
    .from("profiles")
    .select("full_name, phone")
    .eq("user_id", user.userId)
    .maybeSingle()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {user.email} · Centre user at {centre.name} in {project.code}
        </p>
      </div>
      <Panel title="Your details" description="Your email is your sign-in. Ask your project admin to change it.">
        <ProfileForm code={project.code} fullName={profile?.full_name ?? user.fullName} phone={profile?.phone ?? null} />
      </Panel>
      <Panel title="Password">
        <ChangePasswordForm code={project.code} />
      </Panel>
    </div>
  )
}
