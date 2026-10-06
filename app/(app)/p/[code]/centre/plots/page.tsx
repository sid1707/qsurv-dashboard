import { PlotFilters } from "@/components/plots/plot-filters"
import { PlotsView } from "@/components/plots/plots-view"
import { projectCentrePath } from "@/lib/auth/access"
import { formatInteger } from "@/lib/format"
import { parseCompiledFilters } from "@/lib/project-admin/compiled"
import { loadPlotData } from "@/lib/plots/queries"
import { parsePeriod } from "@/lib/plots/summary"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/** Read-only plots of the centre's own compiled data. */
export default async function CentrePlotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { code } = await params
  const { project, centre } = await requireCentreUser(code, { pages: CENTRE_PAGES, page: "plots" })
  const query = await searchParams
  const filters = { ...parseCompiledFilters(query), centre: null }
  const period = parsePeriod(query.period)
  const { data } = await loadPlotData(await createClient(), project, filters, period, centre.id)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Plots</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your centre&apos;s approved results, {formatInteger(data.total)} sample result{data.total === 1 ? "" : "s"}. A result
          counts as detected when its Cq is below the undetermined Ct and within the target&apos;s cut-off.
        </p>
      </div>
      <PlotFilters action={projectCentrePath(project.code, "plots")} filters={filters} period={period} />
      <PlotsView data={data} fileStem={`${project.code}_${centre.code ?? centre.file_code}`} />
    </div>
  )
}
