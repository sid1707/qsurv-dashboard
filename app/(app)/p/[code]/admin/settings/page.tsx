import { Lock } from "lucide-react"
import { KitPanelTable } from "@/components/plate/kit-panel"
import { LayoutPreview } from "@/components/plate/layout-preview"
import { RulesSummary } from "@/components/plate/rules-summary"
import { Panel } from "@/components/project-admin/form"
import { ChangeKitForm, ProjectDetailsForm } from "@/components/project-admin/settings-forms"
import { listActiveKits } from "@/lib/kits/public"
import { instrumentsLabel, sampleTypeLabel, userTierLabel } from "@/lib/onboarding/labels"
import { loadKit, projectHasData } from "@/lib/project-admin/settings"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES, enabledFeatureLabels } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value || "—"}</dd>
    </div>
  )
}

export default async function SettingsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, features } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "settings" })
  const supabase = await createClient()
  const [kit, hasData, activeKits] = await Promise.all([
    loadKit(supabase, project.kit_id),
    projectHasData(supabase, project.id),
    listActiveKits(supabase),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Project details and the qPCR kit.</p>
      </div>

      <Panel title="Project details">
        <ProjectDetailsForm
          code={project.code}
          values={{
            title: project.title,
            objective: project.objective,
            fundingAgency: project.funding_agency,
            ethicsReference: project.ethics_reference,
            startDate: project.start_date,
            endDate: project.end_date,
            frequency: project.frequency,
          }}
        />
      </Panel>

      <Panel title="Set at onboarding" description="Ask the QSurv team to change these.">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Item label="Short code" value={<span className="font-mono">{project.code}</span>} />
          <Item label="Sample type" value={sampleTypeLabel(project.sample_type, project.sample_type_other)} />
          <Item
            label="qPCR instruments"
            value={instrumentsLabel(project.instruments, project.instrument_other, project.instrument)}
          />
          <Item label="Number of users" value={userTierLabel(project.user_tier)} />
          <Item label="Analysis" value={enabledFeatureLabels(features).join(", ")} />
        </dl>
      </Panel>

      <Panel
        title={kit ? `Kit: ${kit.name}` : "Kit"}
        description={kit ? `Version ${kit.version}` : undefined}
      >
        <div className="space-y-6">
          {hasData ? (
            <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              The kit is read only because centres have uploaded data with it. Changing it would change what stored
              results mean.
            </p>
          ) : (
            <ChangeKitForm
              code={project.code}
              currentKitId={project.kit_id}
              kits={[
                ...(activeKits.some((k) => k.id === project.kit_id) || !kit
                  ? []
                  : [{ id: kit.id, label: `${kit.name} (${kit.version})` }]),
                ...activeKits.map((k) => ({ id: k.id, label: `${k.name} (${k.version})` })),
              ]}
            />
          )}
          {kit ? <KitPanelTable tubes={kit.tubes} caption="Targets and controls by tube" /> : null}
          {kit && project.plate_layout ? (
            <div>
              <h4 className="mb-2 text-sm font-medium">Plate layout</h4>
              <LayoutPreview tubes={kit.tubes} layout={project.plate_layout} />
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <RulesSummary title="Quality checks" settings={project.qc_rules} />
            <RulesSummary title="Compilation" settings={project.compile_rules} />
          </div>
        </div>
      </Panel>
    </div>
  )
}
