import { AnnouncementComposeForm } from "@/components/project-admin/announcement-compose-form"
import { AnnouncementHistoryTable } from "@/components/project-admin/announcement-history-table"
import { Panel } from "@/components/project-admin/form"
import { listProjectAnnouncements } from "@/lib/announcements/queries"
import { listCentres } from "@/lib/project-admin/centres"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function AnnouncementsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "announcements" })
  const supabase = await createClient()
  const [centres, rows] = await Promise.all([
    listCentres(supabase, project.id),
    listProjectAnnouncements(supabase, project.id),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Announcements</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Publish a message to this project&apos;s centres. Centre users see it on their workspace until they dismiss it.
        </p>
      </div>
      <Panel title="New announcement" description="Publishes immediately to the selected centres">
        <AnnouncementComposeForm
          code={project.code}
          centres={centres.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
        />
      </Panel>
      <Panel title="History" description="Archive to hide from all centres. Restore does not clear existing dismissals.">
        <AnnouncementHistoryTable code={project.code} rows={rows} />
      </Panel>
    </div>
  )
}
