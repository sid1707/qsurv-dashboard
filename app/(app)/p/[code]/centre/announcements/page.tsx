import { CentreAnnouncementList } from "@/components/centre/centre-actions"
import { listCentreAnnouncements } from "@/lib/announcements/queries"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function CentreAnnouncementsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, user } = await requireCentreUser(code, { pages: CENTRE_PAGES, page: "announcements" })
  const items = await listCentreAnnouncements(await createClient(), project.id, user.userId)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Announcements</h2>
        <p className="mt-1 text-sm text-muted-foreground">Messages from your project admin. Dismiss one once you have read it.</p>
      </div>
      <CentreAnnouncementList code={project.code} items={items} />
    </div>
  )
}
