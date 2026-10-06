import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { parseDisplayDateToYmd } from "@/lib/format"

/** Filters of the compiled data page and its CSV download, read from the URL. */
export type CompiledFilters = { centre: string | null; from: string | null; to: string | null; target: string | null }

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function param(params: Params, key: string): string {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key]
  return (Array.isArray(v) ? v[0] : v ?? "").trim()
}

/** Bad values are dropped rather than failing the page. A reversed range is swapped. */
export function parseCompiledFilters(params: Params): CompiledFilters {
  const centre = param(params, "centre")
  const target = param(params, "target")
  let from = parseDisplayDateToYmd(param(params, "from"))
  let to = parseDisplayDateToYmd(param(params, "to"))
  if (from && to && from > to) [from, to] = [to, from]
  return {
    centre: z.uuid().safeParse(centre).success ? centre : null,
    from,
    to,
    target: target && target.length <= 100 ? target : null,
  }
}

export function filtersToSearch(filters: CompiledFilters): string {
  const q = new URLSearchParams()
  for (const key of ["centre", "from", "to", "target"] as const) if (filters[key]) q.set(key, filters[key]!)
  const s = q.toString()
  return s ? `?${s}` : ""
}

export type CompiledRow = {
  id: number
  centre_id: string
  collection_date: string | null
  sample_label: string | null
  target_name: string
  cq_value: number | null
  cq_sd: number | null
  normalized_cq: number | null
  copy_number: number | null
  copy_number_sd: number | null
  metric_payload: Record<string, unknown> | null
}

const COMPILED_SELECT =
  "id, centre_id, collection_date, sample_label, target_name, cq_value, cq_sd, normalized_cq, copy_number, copy_number_sd, metric_payload"

/** Page size of the table, and the PostgREST row cap the CSV download pages through. */
export const PAGE_SIZE = 200
const FETCH_CHUNK = 1000
export const MAX_EXPORT_ROWS = 100_000

function filtered(supabase: SupabaseClient, projectId: string, filters: CompiledFilters, count = false) {
  let q = supabase
    .from("compiled_measurements")
    .select(COMPILED_SELECT, count ? { count: "exact" } : undefined)
    .eq("project_id", projectId)
  if (filters.centre) q = q.eq("centre_id", filters.centre)
  if (filters.target) q = q.eq("target_name", filters.target)
  if (filters.from) q = q.gte("collection_date", filters.from)
  if (filters.to) q = q.lte("collection_date", filters.to)
  return q
    .order("collection_date", { ascending: false, nullsFirst: false })
    .order("centre_id")
    .order("id")
}

/** One page for the table, with the total for the filters. RLS limits rows to what the caller may see. */
export async function listCompiled(
  supabase: SupabaseClient,
  projectId: string,
  filters: CompiledFilters,
  page = 0
): Promise<{ rows: CompiledRow[]; total: number }> {
  const start = page * PAGE_SIZE
  const { data, error, count } = await filtered(supabase, projectId, filters, true).range(start, start + PAGE_SIZE - 1)
  if (error) throw new Error(`Could not load compiled data: ${error.message}`)
  return { rows: (data ?? []) as CompiledRow[], total: count ?? 0 }
}

/** Every matching row, in pages of the API's row cap. */
export async function fetchAllCompiled(supabase: SupabaseClient, projectId: string, filters: CompiledFilters): Promise<CompiledRow[]> {
  const rows: CompiledRow[] = []
  for (let start = 0; start < MAX_EXPORT_ROWS; start += FETCH_CHUNK) {
    const { data, error } = await filtered(supabase, projectId, filters).range(start, start + FETCH_CHUNK - 1)
    if (error) throw new Error(`Could not load compiled data: ${error.message}`)
    rows.push(...((data ?? []) as CompiledRow[]))
    if (!data || data.length < FETCH_CHUNK) break
  }
  return rows
}

export type CentreLabel = { id: string; name: string; code: string | null }

export async function listProjectCentres(supabase: SupabaseClient, projectId: string): Promise<CentreLabel[]> {
  const { data, error } = await supabase.from("centres").select("id, name, code").eq("project_id", projectId).order("name")
  if (error) throw new Error(`Could not load centres: ${error.message}`)
  return (data ?? []) as CentreLabel[]
}

export const sourceFileOf = (row: CompiledRow) =>
  typeof row.metric_payload?.source_file === "string" ? (row.metric_payload.source_file as string) : null

export const COMPILED_CSV_HEADERS = [
  "Centre_ID",
  "Centre_Name",
  "Collection_Date",
  "Sample",
  "Target",
  "Cq",
  "Cq_SD",
  "Normalized_Cq",
  "Copy_Number",
  "Copy_Number_SD",
  "Source_File",
] as const

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (= + - @, tab,
 * carriage return) is prefixed with an apostrophe; numbers are written as is.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : ""
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const n = (v: number | string | null) => (v === null ? null : Number(v))

export function compiledToCsv(rows: CompiledRow[], centres: CentreLabel[]): string {
  const byId = new Map(centres.map((c) => [c.id, c]))
  const lines = [COMPILED_CSV_HEADERS.join(",")]
  for (const r of rows) {
    const centre = byId.get(r.centre_id)
    lines.push(
      [
        csvCell(centre?.code ?? null),
        csvCell(centre?.name ?? null),
        csvCell(r.collection_date?.slice(0, 10) ?? null),
        csvCell(r.sample_label),
        csvCell(r.target_name),
        csvCell(n(r.cq_value)),
        csvCell(n(r.cq_sd)),
        csvCell(n(r.normalized_cq)),
        csvCell(n(r.copy_number)),
        csvCell(n(r.copy_number_sd)),
        csvCell(sourceFileOf(r)),
      ].join(",")
    )
  }
  return `${lines.join("\r\n")}\r\n`
}
