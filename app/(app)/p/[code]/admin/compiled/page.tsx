import Link from "next/link"
import { Download } from "lucide-react"
import { inputClass } from "@/components/project-admin/form"
import { buttonVariants } from "@/components/ui/button"
import { DmyDateInput } from "@/components/ui/dmy-date-input"
import { projectAdminPath } from "@/lib/auth/access"
import { formatDateFromDb, formatInteger } from "@/lib/format"
import {
  PAGE_SIZE,
  filtersToSearch,
  listCompiled,
  listProjectCentres,
  parseCompiledFilters,
  sourceFileOf,
} from "@/lib/project-admin/compiled"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES } from "@/lib/projects/features"
import { RULES_BY_ID, normalizationMethodOf } from "@/lib/rules/catalog"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const num = (v: number | null) => (v === null ? "—" : String(v))

export default async function CompiledDataPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { code } = await params
  const { project } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "compiled" })
  const query = await searchParams
  const filters = parseCompiledFilters(query)
  const page = Math.max(0, Number.parseInt(String(query.page ?? "1"), 10) - 1 || 0)

  const supabase = await createClient()
  const [{ rows, total }, centres, kitTargets] = await Promise.all([
    listCompiled(supabase, project.id, filters, page),
    listProjectCentres(supabase, project.id),
    supabase.from("kit_targets").select("target_name, sort_order").eq("kit_id", project.kit_id).order("sort_order"),
  ])
  const targets = (kitTargets.data ?? []).map((t) => t.target_name as string)
  const centreById = new Map(centres.map((c) => [c.id, c]))
  const base = projectAdminPath(project.code, "compiled")
  const search = filtersToSearch(filters)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const normalization = project.compile_rules?.endogenous_normalization
  const method = normalization?.enabled
    ? RULES_BY_ID.get("endogenous_normalization")?.choices?.[0].options.find((o) => o.value === normalizationMethodOf(normalization))
    : undefined
  const pageHref = (p: number) => `${base}${search ? `${search}&` : "?"}page=${p + 1}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Compiled data</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per sample and target, from approved uploads. Control wells are left out.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {method ? `Normalised: ${method.label} — ${method.description}` : "Normalisation to an endogenous control is off for this project."}
          </p>
        </div>
        <a
          href={`/api/projects/${encodeURIComponent(project.code)}/compiled/export${search}`}
          className={buttonVariants({ variant: "outline" })}
          download
        >
          <Download className="size-4" aria-hidden /> Download CSV
        </a>
      </div>

      <form method="get" action={base} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="filter-centre" className="text-sm font-medium">Centre</label>
          <select id="filter-centre" name="centre" defaultValue={filters.centre ?? ""} className={inputClass}>
            <option value="">All centres</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} — ` : ""}
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="filter-from" className="text-sm font-medium">Collected from</label>
          <DmyDateInput id="filter-from" name="from" defaultYmd={filters.from ?? undefined} />
        </div>
        <div className="space-y-1">
          <label htmlFor="filter-to" className="text-sm font-medium">to</label>
          <DmyDateInput id="filter-to" name="to" defaultYmd={filters.to ?? undefined} />
        </div>
        <div className="space-y-1">
          <label htmlFor="filter-target" className="text-sm font-medium">Target</label>
          <select id="filter-target" name="target" defaultValue={filters.target ?? ""} className={inputClass}>
            <option value="">All targets</option>
            {targets.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonVariants()}>
            Apply
          </button>
          {search ? (
            <Link href={base} className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <p className="text-sm text-muted-foreground">
        {formatInteger(total)} row{total === 1 ? "" : "s"}
        {total > PAGE_SIZE ? ` · page ${page + 1} of ${pages}` : ""}
      </p>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="px-3 py-2 font-medium">Centre</th>
              <th scope="col" className="px-3 py-2 font-medium">Collected</th>
              <th scope="col" className="px-3 py-2 font-medium">Sample</th>
              <th scope="col" className="px-3 py-2 font-medium">Target</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Cq</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Cq SD</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Normalised</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Copies</th>
              <th scope="col" className="px-3 py-2 font-medium">Source file</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  {search ? "No compiled data matches these filters." : "No compiled data yet. Approved uploads appear here."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const centre = centreById.get(r.centre_id)
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{centre ? `${centre.code ? `${centre.code} — ` : ""}${centre.name}` : "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateFromDb(r.collection_date)}</td>
                    <td className="px-3 py-2">{r.sample_label ?? "—"}</td>
                    <td className="px-3 py-2">{r.target_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.cq_value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.cq_sd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.normalized_cq)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.copy_number === null ? "—" : `${num(r.copy_number)}${r.copy_number_sd ? ` ± ${num(r.copy_number_sd)}` : ""}`}
                    </td>
                    <td className="px-3 py-2 text-xs break-all text-muted-foreground">{sourceFileOf(r) ?? "—"}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 0 ? (
            <Link href={pageHref(page - 1)} className="underline underline-offset-4">
              Previous
            </Link>
          ) : (
            <span />
          )}
          {page + 1 < pages ? (
            <Link href={pageHref(page + 1)} className="underline underline-offset-4">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
