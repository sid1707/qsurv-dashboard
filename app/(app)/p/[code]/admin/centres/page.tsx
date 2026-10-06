import { Panel } from "@/components/project-admin/form"
import { AddCentreForm, CentreList } from "@/components/project-admin/centres-manager"
import { listCentres } from "@/lib/project-admin/centres"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function CentresPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "centres" })
  const centres = await listCentres(await createClient(), project.id)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Centres</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Partner centres that upload qPCR runs. Deactivating a centre keeps its users and data, but it cannot receive
          new users or announcements.
        </p>
      </div>
      <Panel title="Add a centre">
        <AddCentreForm code={project.code} />
      </Panel>
      <Panel title={`All centres (${centres.length})`}>
        <CentreList code={project.code} centres={centres} />
      </Panel>
    </div>
  )
}
