import Link from "next/link"
import { inputClass } from "@/components/project-admin/form"
import { buttonVariants } from "@/components/ui/button"
import { DmyDateInput } from "@/components/ui/dmy-date-input"
import type { CentreLabel, CompiledFilters } from "@/lib/project-admin/compiled"
import { centreLabel, type Period } from "@/lib/plots/summary"

/** One row of filters above the charts. Centres are offered only to project admins. */
export function PlotFilters({
  action,
  filters,
  period,
  centres,
}: {
  action: string
  filters: CompiledFilters
  period: Period
  centres?: CentreLabel[]
}) {
  const active = filters.centre || filters.from || filters.to || period !== "month"
  return (
    <form method="get" action={action} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
      {centres ? (
        <div className="space-y-1">
          <label htmlFor="plot-centre" className="text-sm font-medium">Centre</label>
          <select id="plot-centre" name="centre" defaultValue={filters.centre ?? ""} className={inputClass}>
            <option value="">All centres</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {centreLabel(c)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="hidden lg:block" />
      )}
      <div className="space-y-1">
        <label htmlFor="plot-from" className="text-sm font-medium">Collected from</label>
        <DmyDateInput id="plot-from" name="from" defaultYmd={filters.from ?? undefined} />
      </div>
      <div className="space-y-1">
        <label htmlFor="plot-to" className="text-sm font-medium">to</label>
        <DmyDateInput id="plot-to" name="to" defaultYmd={filters.to ?? undefined} />
      </div>
      <div className="space-y-1">
        <label htmlFor="plot-period" className="text-sm font-medium">Group by</label>
        <select id="plot-period" name="period" defaultValue={period} className={inputClass}>
          <option value="month">Month</option>
          <option value="week">Week</option>
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={buttonVariants()}>
          Apply
        </button>
        {active ? (
          <Link href={action} className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  )
}
