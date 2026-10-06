import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllCompiled, listProjectCentres, type CompiledFilters } from "@/lib/project-admin/compiled"
import type { ProjectRecord } from "@/lib/projects/context"
import { buildPlotData, undeterminedCtOf, type Period, type PlotData, type PlotTarget } from "@/lib/plots/summary"

/** Surveillance targets of the kit, in panel order. Internal and run controls are not plotted. */
export async function listPlotTargets(supabase: SupabaseClient, kitId: string): Promise<PlotTarget[]> {
  const { data, error } = await supabase
    .from("kit_targets")
    .select("target_name, ct_max, control_type, sort_order")
    .eq("kit_id", kitId)
    .order("sort_order")
  if (error) throw new Error(`Could not load the kit targets: ${error.message}`)
  return (data ?? [])
    .filter((t) => t.control_type === "none")
    .map((t) => ({ name: t.target_name as string, ctMax: t.ct_max === null ? null : Number(t.ct_max) }))
}

/**
 * Plot data for the project. Pass `centreId` for a centre user: the query is
 * pinned to that centre, on top of RLS, which already hides other centres.
 */
export async function loadPlotData(
  supabase: SupabaseClient,
  project: Pick<ProjectRecord, "id" | "kit_id" | "compile_rules">,
  filters: CompiledFilters,
  period: Period,
  centreId?: string
): Promise<{ data: PlotData; allCentres: Awaited<ReturnType<typeof listProjectCentres>> }> {
  const scoped = { ...filters, target: null, centre: centreId ?? filters.centre }
  const [rows, targets, centres] = await Promise.all([
    fetchAllCompiled(supabase, project.id, scoped),
    listPlotTargets(supabase, project.kit_id),
    listProjectCentres(supabase, project.id),
  ])
  const data = buildPlotData(rows, targets, centres, { period, undeterminedCt: undeterminedCtOf(project.compile_rules) })
  return { data, allCentres: centres }
}
