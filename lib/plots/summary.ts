import { csvCell, type CentreLabel, type CompiledRow } from "@/lib/project-admin/compiled"
import type { RuleSettings } from "@/lib/rules/catalog"

/** A kit target as the plots need it. Only targets with control_type 'none' are plotted. */
export type PlotTarget = { name: string; ctMax: number | null }

export type Period = "month" | "week"

export function parsePeriod(value: string | string[] | undefined): Period {
  return (Array.isArray(value) ? value[0] : value) === "week" ? "week" : "month"
}

/**
 * The Ct that marks "undetermined" in compiled data: the compile rule
 * undetermined_to_max writes no-reading wells as this value. Null when the rule
 * is off (then undetermined is stored as a null Cq).
 */
export function undeterminedCtOf(compileRules: RuleSettings | null): number | null {
  const rule = compileRules?.undetermined_to_max
  return rule?.enabled && Number.isFinite(rule.params?.ct) ? rule.params.ct : null
}

/**
 * Detected: a Cq below the undetermined Ct and not above the target's cut-off
 * (kit_targets.ct_max, "values above are treated as not detected").
 */
export function isDetected(cq: number | string | null, target: PlotTarget, undeterminedCt: number | null): boolean {
  if (cq === null) return false
  const v = Number(cq)
  if (!Number.isFinite(v)) return false
  if (undeterminedCt !== null && v >= undeterminedCt) return false
  return target.ctMax === null || v <= target.ctMax
}

/** Start of the bucket a YYYY-MM-DD date falls in: YYYY-MM for months, the Monday (YYYY-MM-DD) for weeks. */
export function periodKey(ymd: string, period: Period): string {
  if (period === "month") return ymd.slice(0, 7)
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/** Every bucket from first to last, so gaps show as gaps rather than being skipped. */
export function periodRange(first: string, last: string, period: Period): string[] {
  const keys: string[] = []
  if (period === "month") {
    let [y, m] = first.split("-").map(Number)
    const [ly, lm] = last.split("-").map(Number)
    while (y < ly || (y === ly && m <= lm)) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`)
      if (++m > 12) [y, m] = [y + 1, 1]
    }
    return keys
  }
  const d = new Date(`${first}T00:00:00Z`)
  const end = new Date(`${last}T00:00:00Z`)
  while (d <= end) {
    keys.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return keys
}

/** Linear-interpolated quantile of sorted values (the method spreadsheets call QUARTILE.INC). */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export type BoxStats = { n: number; min: number; q1: number; median: number; q3: number; max: number; outliers: number[] }

/** Tukey box: whiskers reach the furthest values within 1.5 IQR; the rest are outliers. */
export function boxStats(values: number[]): BoxStats | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const q1 = quantile(s, 0.25)
  const q3 = quantile(s, 0.75)
  const fence = 1.5 * (q3 - q1)
  const inside = s.filter((v) => v >= q1 - fence && v <= q3 + fence)
  return {
    n: s.length,
    min: inside[0],
    q1,
    median: quantile(s, 0.5),
    q3,
    max: inside[inside.length - 1],
    outliers: s.filter((v) => v < q1 - fence || v > q3 + fence),
  }
}

export type RateCell = { tested: number; detected: number; rate: number | null }

const rate = (tested: number, detected: number): RateCell => ({ tested, detected, rate: tested ? detected / tested : null })

export type PlotData = {
  targets: string[]
  period: Period
  /** Bucket keys along the x axis. */
  periods: string[]
  /** detection[target][i] lines up with periods[i]. */
  detection: Record<string, RateCell[]>
  ct: Record<string, BoxStats | null>
  centres: { id: string; label: string }[]
  /** heatmap[centreId][target]. */
  heatmap: Record<string, Record<string, RateCell>>
  /** Rows of plotted targets with no collection date: in the box plot and heatmap, not over time. */
  undated: number
  total: number
}

export const centreLabel = (c: CentreLabel) => (c.code ? `${c.code} — ${c.name}` : c.name)

/** Everything the three charts draw, from compiled rows the caller may see (RLS already applied). */
export function buildPlotData(
  rows: Pick<CompiledRow, "centre_id" | "collection_date" | "target_name" | "cq_value">[],
  targets: PlotTarget[],
  centres: CentreLabel[],
  opts: { period: Period; undeterminedCt: number | null }
): PlotData {
  const byName = new Map(targets.map((t) => [t.name, t]))
  const counts = new Map<string, { tested: number; detected: number }>()
  const bump = (key: string, hit: boolean) => {
    const c = counts.get(key) ?? { tested: 0, detected: 0 }
    c.tested++
    if (hit) c.detected++
    counts.set(key, c)
  }
  const cts = new Map<string, number[]>(targets.map((t) => [t.name, []]))
  const seenPeriods = new Set<string>()
  const seenCentres = new Set<string>()
  let undated = 0
  let total = 0

  for (const r of rows) {
    const target = byName.get(r.target_name)
    if (!target) continue
    total++
    const hit = isDetected(r.cq_value, target, opts.undeterminedCt)
    if (hit) cts.get(target.name)!.push(Number(r.cq_value))
    seenCentres.add(r.centre_id)
    bump(`c|${r.centre_id}|${target.name}`, hit)
    if (!r.collection_date) {
      undated++
      continue
    }
    const key = periodKey(r.collection_date, opts.period)
    seenPeriods.add(key)
    bump(`p|${key}|${target.name}`, hit)
  }

  const sorted = [...seenPeriods].sort()
  const periods = sorted.length ? periodRange(sorted[0], sorted[sorted.length - 1], opts.period) : []
  const cell = (key: string) => {
    const c = counts.get(key)
    return rate(c?.tested ?? 0, c?.detected ?? 0)
  }
  const names = targets.map((t) => t.name)
  const shownCentres = centres.filter((c) => seenCentres.has(c.id))

  return {
    targets: names,
    period: opts.period,
    periods,
    detection: Object.fromEntries(names.map((t) => [t, periods.map((p) => cell(`p|${p}|${t}`))])),
    ct: Object.fromEntries(names.map((t) => [t, boxStats(cts.get(t)!)])),
    centres: shownCentres.map((c) => ({ id: c.id, label: centreLabel(c) })),
    heatmap: Object.fromEntries(shownCentres.map((c) => [c.id, Object.fromEntries(names.map((t) => [t, cell(`c|${c.id}|${t}`)]))])),
    undated,
    total,
  }
}

const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10)
const round = (v: number) => Math.round(v * 100) / 100

/** The data behind one chart: shown as its table view and downloaded as its CSV. */
export type DataTable = { header: string[]; rows: (string | number | null)[][] }

export const tableToCsv = (t: DataTable) =>
  `${[t.header.join(","), ...t.rows.map((r) => r.map(csvCell).join(","))].join("\r\n")}\r\n`

export function detectionTable(d: PlotData): DataTable {
  const rows: DataTable["rows"] = []
  for (const t of d.targets)
    d.periods.forEach((p, i) => {
      const c = d.detection[t][i]
      if (c.tested) rows.push([p, t, c.tested, c.detected, pct(c.rate)])
    })
  return { header: [d.period === "week" ? "Week_Starting" : "Month", "Target", "Tested", "Detected", "Detection_Rate_Pct"], rows }
}

export function ctTable(d: PlotData): DataTable {
  return {
    header: ["Target", "N_Detected", "Min_Whisker", "Q1", "Median", "Q3", "Max_Whisker", "Outliers"],
    rows: d.targets.map((t) => {
      const b = d.ct[t]
      return b
        ? [t, b.n, round(b.min), round(b.q1), round(b.median), round(b.q3), round(b.max), b.outliers.map(round).join(" ")]
        : [t, 0, null, null, null, null, null, null]
    }),
  }
}

export function heatmapTable(d: PlotData): DataTable {
  const rows: DataTable["rows"] = []
  for (const c of d.centres)
    for (const t of d.targets) {
      const cell = d.heatmap[c.id][t]
      rows.push([c.label, t, cell.tested, cell.detected, pct(cell.rate)])
    }
  return { header: ["Centre", "Target", "Tested", "Detected", "Positivity_Pct"], rows }
}
