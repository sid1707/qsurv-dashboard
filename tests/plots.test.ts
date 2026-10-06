import { describe, expect, it } from "vitest"
import { fakeSupabase } from "./fake-supabase"
import { periodLabel } from "../components/plots/plots-view"
import { SERIES, OVERFLOW, targetColour } from "../lib/plots/palette"
import { listPlotTargets, loadPlotData } from "../lib/plots/queries"
import {
  boxStats,
  buildPlotData,
  ctTable,
  detectionTable,
  heatmapTable,
  isDetected,
  parsePeriod,
  periodKey,
  periodRange,
  tableToCsv,
  undeterminedCtOf,
  type PlotTarget,
} from "../lib/plots/summary"
import { ADMIN_PAGES, CENTRE_PAGES, isPageEnabled, visiblePages } from "../lib/projects/features"

const C1 = "20000000-0000-4000-8000-000000000001"
const C2 = "20000000-0000-4000-8000-000000000002"
const CENTRES = [
  { id: C1, name: "AIIMS", code: "C01" },
  { id: C2, name: "Huwel Lab", code: null },
]
const A: PlotTarget = { name: "Target A", ctMax: null }
const B: PlotTarget = { name: "Target B", ctMax: 35 }

const r = (centre_id: string, collection_date: string | null, target_name: string, cq_value: number | null) => ({
  centre_id,
  collection_date,
  target_name,
  cq_value,
})

describe("detection", () => {
  it("reads the undetermined Ct from the compile rules only when the rule is on", () => {
    expect(undeterminedCtOf({ undetermined_to_max: { enabled: true, params: { ct: 40 } } })).toBe(40)
    expect(undeterminedCtOf({ undetermined_to_max: { enabled: false, params: { ct: 40 } } })).toBeNull()
    expect(undeterminedCtOf(null)).toBeNull()
  })

  it("is a Cq below the undetermined Ct and within the target's cut-off", () => {
    expect(isDetected(24, A, 40)).toBe(true)
    expect(isDetected(40, A, 40)).toBe(false)
    expect(isDetected(null, A, 40)).toBe(false)
    expect(isDetected(35, B, 40)).toBe(true)
    expect(isDetected(35.1, B, 40)).toBe(false)
    // Postgres numerics can arrive as strings.
    expect(isDetected("22.5", A, null)).toBe(true)
    expect(isDetected(45, A, null)).toBe(true)
  })
})

describe("periods", () => {
  it("buckets by month or by the Monday of the week", () => {
    expect(periodKey("2026-10-06", "month")).toBe("2026-10")
    expect(periodKey("2026-10-04", "week")).toBe("2026-09-28") // Sunday
    expect(periodKey("2026-10-05", "week")).toBe("2026-10-05") // Monday
  })

  it("fills every bucket between the first and last, across a year end", () => {
    expect(periodRange("2026-11", "2027-02", "month")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"])
    expect(periodRange("2026-09-28", "2026-10-12", "week")).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"])
  })

  it("defaults to months and labels buckets for the axis", () => {
    expect(parsePeriod("week")).toBe("week")
    expect(parsePeriod(["bad"])).toBe("month")
    expect(periodLabel("2026-10", "month")).toBe("Oct 2026")
    expect(periodLabel("2026-10-05", "week")).toBe("05 Oct 2026")
  })
})

describe("box stats", () => {
  it("gives quartiles, Tukey whiskers and outliers", () => {
    const b = boxStats([20, 21, 22, 23, 24, 40])!
    expect(b).toMatchObject({ n: 6, q1: 21.25, median: 22.5, q3: 23.75, min: 20, max: 24, outliers: [40] })
    expect(boxStats([])).toBeNull()
  })
})

describe("buildPlotData", () => {
  const rows = [
    r(C1, "2026-08-03", "Target A", 24),
    r(C1, "2026-08-10", "Target A", 40),
    r(C2, "2026-10-01", "Target A", 30),
    r(C2, "2026-10-01", "Target B", 36), // above B's cut-off
    r(C1, null, "Target B", 30),
    r(C1, "2026-10-01", "RNase P", 25), // not a plotted target
  ]
  const d = buildPlotData(rows, [A, B], CENTRES, { period: "month", undeterminedCt: 40 })

  it("keeps targets in kit order and ignores rows of other targets", () => {
    expect(d.targets).toEqual(["Target A", "Target B"])
    expect(d.total).toBe(5)
    expect(d.undated).toBe(1)
  })

  it("rates detection per period, leaving a month without samples as a gap", () => {
    expect(d.periods).toEqual(["2026-08", "2026-09", "2026-10"])
    expect(d.detection["Target A"]).toEqual([
      { tested: 2, detected: 1, rate: 0.5 },
      { tested: 0, detected: 0, rate: null },
      { tested: 1, detected: 1, rate: 1 },
    ])
    expect(d.detection["Target B"][2]).toEqual({ tested: 1, detected: 0, rate: 0 })
  })

  it("plots the Cq of detected results only, undated ones included", () => {
    expect(d.ct["Target A"]).toMatchObject({ n: 2, median: 27 })
    expect(d.ct["Target B"]).toMatchObject({ n: 1, median: 30 })
  })

  it("builds the centre by target positivity grid from centres with data", () => {
    expect(d.centres).toEqual([
      { id: C1, label: "C01 — AIIMS" },
      { id: C2, label: "Huwel Lab" },
    ])
    expect(d.heatmap[C1]["Target B"]).toEqual({ tested: 1, detected: 1, rate: 1 })
    expect(d.heatmap[C2]["Target B"]).toEqual({ tested: 1, detected: 0, rate: 0 })
  })

  it("writes each chart's data as a CSV table", () => {
    expect(tableToCsv(detectionTable(d)).split("\r\n").slice(0, 2)).toEqual([
      "Month,Target,Tested,Detected,Detection_Rate_Pct",
      "2026-08,Target A,2,1,50",
    ])
    expect(ctTable(d).rows[0]).toEqual(["Target A", 2, 24, 25.5, 27, 28.5, 30, ""])
    expect(heatmapTable(d).rows).toContainEqual(["C01 — AIIMS", "Target A", 2, 1, 50])
    // Centre names are text a spreadsheet could run; csvCell guards them.
    expect(tableToCsv({ header: ["Centre"], rows: [["=HYPERLINK()"]] })).toBe("Centre\r\n'=HYPERLINK()\r\n")
  })

  it("is empty without rows", () => {
    const e = buildPlotData([], [A], CENTRES, { period: "week", undeterminedCt: 40 })
    expect(e).toMatchObject({ total: 0, periods: [], centres: [], ct: { "Target A": null } })
  })
})

describe("colours", () => {
  it("gives a target the same slot in every chart and greys out past eight", () => {
    expect(targetColour(0, "light")).toBe(SERIES.light[0])
    expect(targetColour(0, "dark")).toBe(SERIES.dark[0])
    expect(targetColour(8, "light")).toBe(OVERFLOW.light)
  })
})

describe("queries", () => {
  it("plots only the kit's surveillance targets, in panel order", async () => {
    const fake = fakeSupabase({
      "kit_targets.select": {
        data: [
          { target_name: "Target A", ct_max: null, control_type: "none" },
          { target_name: "RNase P", ct_max: "35", control_type: "internal_control" },
          { target_name: "Target B", ct_max: "35", control_type: "none" },
        ],
      },
    })
    expect(await listPlotTargets(fake.client, "kit")).toEqual([A, B])
    expect(fake.calls[0].filters).toContainEqual(["order:sort_order", undefined])
  })

  it("pins a centre user's query to their own centre", async () => {
    const fake = fakeSupabase({
      "compiled_measurements.select": { data: [{ ...r(C1, "2026-10-01", "Target A", 24), id: 1 }] },
      "kit_targets.select": { data: [{ target_name: "Target A", ct_max: null, control_type: "none" }] },
      "centres.select": { data: CENTRES },
    })
    const project = { id: "p", kit_id: "kit", compile_rules: null }
    const { data } = await loadPlotData(fake.client, project, { centre: C2, from: null, to: null, target: "x" }, "month", C1)
    const compiled = fake.calls.find((c) => c.table === "compiled_measurements")!
    expect(compiled.filters).toContainEqual(["eq:centre_id", C1])
    expect(compiled.filters).not.toContainEqual(["eq:target_name", "x"])
    expect(data.total).toBe(1)
  })
})

describe("plots page visibility", () => {
  const on = { data_management: true, data_compilation: true, data_plotting: true }
  const off = { ...on, data_plotting: false }

  it("shows Plots to admins and centre users only when data plotting is on", () => {
    expect(visiblePages(ADMIN_PAGES, on).map((p) => p.page)).toContain("plots")
    expect(visiblePages(ADMIN_PAGES, off).map((p) => p.page)).not.toContain("plots")
    expect(isPageEnabled(CENTRE_PAGES, "plots", on)).toBe(true)
    expect(isPageEnabled(CENTRE_PAGES, "plots", off)).toBe(false)
  })
})
