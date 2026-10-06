import { PlotFilters } from "@/components/plots/plot-filters"
import { PlotsView } from "@/components/plots/plots-view"
import { projectAdminPath } from "@/lib/auth/access"
import { formatInteger } from "@/lib/format"
import { parseCompiledFilters } from "@/lib/project-admin/compiled"
import { loadPlotData } from "@/lib/plots/queries"
import { parsePeriod } from "@/lib/plots/summary"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function AdminPlotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { code } = await params
  const { project } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "plots" })
  const query = await searchParams
  const filters = parseCompiledFilters(query)
  const period = parsePeriod(query.period)
  const { data, allCentres } = await loadPlotData(await createClient(), project, filters, period)
  const centre = allCentres.find((c) => c.id === filters.centre)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Plots</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          From compiled data of approved uploads, {formatInteger(data.total)} sample result{data.total === 1 ? "" : "s"}. A
          result counts as detected when its Cq is below the undetermined Ct and within the target&apos;s cut-off.
        </p>
      </div>
      <PlotFilters action={projectAdminPath(project.code, "plots")} filters={filters} period={period} centres={allCentres} />
      <PlotsView data={data} fileStem={`${project.code}${centre?.code ? `_${centre.code}` : ""}`} />
    </div>
  )
}
