import { KitPanelTable } from "@/components/plate/kit-panel"
import { LayoutPreview } from "@/components/plate/layout-preview"
import { UploadForm } from "@/components/centre/upload-form"
import { Panel } from "@/components/project-admin/form"
import { projectCentrePath } from "@/lib/auth/access"
import { exampleFileName } from "@/lib/centres/file-name"
import { samplesPerPlate } from "@/lib/plate/layout"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES } from "@/lib/projects/features"
import { INSTRUMENT_PROFILES, instrumentOptionLabel, projectInstruments } from "@/lib/qpcr/instruments"
import { createClient } from "@/lib/supabase/server"
import { loadValidationSetup } from "@/lib/validation/setup"
import { expectedDateCount } from "@/lib/validation/split/router"

export const dynamic = "force-dynamic"

export default async function UploadPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, centre } = await requireCentreUser(code, { pages: CENTRE_PAGES, page: "upload" })
  const setup = await loadValidationSetup(await createClient(), project)
  const instruments = projectInstruments(project).map((id) => ({
    id,
    label: instrumentOptionLabel(id, project.instrument_other),
    runfileExtensions: INSTRUMENT_PROFILES[id].runfileExtensions,
    exportHint: INSTRUMENT_PROFILES[id].exportHint,
  }))
  const plate = {
    samples: samplesPerPlate(setup.layout.counts),
    mode: setup.layout.multiSample?.mode ?? null,
    dateCount: expectedDateCount(setup.layout),
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Upload a run</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the instrument&apos;s results export (.csv) and its run file. The export is checked against the{" "}
          {setup.panel.name} kit and the project&apos;s plate layout before anything is saved.
        </p>
      </div>

      <Panel title="Run files">
        {!centre.active ? (
          <p className="text-sm text-muted-foreground">Uploads are paused because your centre has been deactivated.</p>
        ) : !centre.code ? (
          <p className="text-sm">
            Your centre has no centre ID yet. File names start with it ({"<Centre ID>"}_{centre.file_code}_DDMMYY.csv), so
            ask your project admin to set it before uploading.
          </p>
        ) : (
          <UploadForm
            projectCode={project.code}
            instruments={instruments}
            uploadsHref={projectCentrePath(project.code, "uploads")}
            fileNameExample={exampleFileName({ centreId: centre.code, fileCode: centre.file_code }, plate.dateCount)}
            plate={plate}
          />
        )}
      </Panel>

      <Panel title="What the export must contain" description="Every target in these tubes, in the wells the plate layout gives them.">
        <div className="space-y-6">
          <KitPanelTable tubes={setup.panel.tubes} caption={`${setup.panel.name} (${setup.panel.version})`} />
          <div>
            <h4 className="mb-2 text-sm font-medium">Plate layout</h4>
            <LayoutPreview tubes={setup.panel.tubes} layout={setup.layout} />
          </div>
        </div>
      </Panel>
    </div>
  )
}
