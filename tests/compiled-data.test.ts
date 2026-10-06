import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
import { fakeSupabase } from "./fake-supabase"
import {
  compiledToCsv,
  csvCell,
  fetchAllCompiled,
  filtersToSearch,
  parseCompiledFilters,
  type CompiledRow,
} from "../lib/project-admin/compiled"
import { ADMIN_PAGES, visiblePages } from "../lib/projects/features"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }))
vi.mock("@/lib/project-admin/api-auth", () => ({ requireProjectAdminApi: mocks.auth }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))

import { GET as exportRoute } from "../app/api/projects/[code]/compiled/export/route"

const CENTRE = "20000000-0000-4000-8000-000000000001"

const row = (overrides: Partial<CompiledRow> = {}): CompiledRow => ({
  id: 1,
  centre_id: CENTRE,
  collection_date: "2026-10-01",
  sample_label: "WW-01",
  target_name: "Target A",
  cq_value: 24.55,
  cq_sd: 0.14,
  normalized_cq: 1.659,
  copy_number: null,
  copy_number_sd: null,
  metric_payload: { source_file: "C01_run.csv" },
  ...overrides,
})

describe("compiled data filters", () => {
  it("reads centre, date range and target, dropping bad values", () => {
    expect(parseCompiledFilters({ centre: CENTRE, from: "01/10/2026", to: "2026-10-31", target: "Target A" })).toEqual({
      centre: CENTRE,
      from: "2026-10-01",
      to: "2026-10-31",
      target: "Target A",
    })
    expect(parseCompiledFilters({ centre: "x' or 1=1", from: "31/02/2026", to: "", target: ["", "B"] })).toEqual({
      centre: null,
      from: null,
      to: null,
      target: null,
    })
  })

  it("swaps a reversed range and round-trips through the URL", () => {
    const filters = parseCompiledFilters(new URLSearchParams("from=2026-10-31&to=2026-10-01&target=Target%20A"))
    expect(filters).toMatchObject({ from: "2026-10-01", to: "2026-10-31" })
    expect(parseCompiledFilters(new URLSearchParams(filtersToSearch(filters).slice(1)))).toEqual(filters)
    expect(filtersToSearch({ centre: null, from: null, to: null, target: null })).toBe("")
  })
})

describe("compiled data CSV", () => {
  it("quotes text and keeps spreadsheet formulas from running", () => {
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)")
    expect(csvCell("-2+3")).toBe("'-2+3")
    expect(csvCell(-1.5)).toBe("-1.5")
    expect(csvCell(null)).toBe("")
  })

  it("writes one line per row with the centre's ID and name, and the normalisation method", () => {
    const csv = compiledToCsv(
      [
        row(),
        row({ id: 2, sample_label: null, normalized_cq: null, copy_number: 1200.5 }),
        row({ id: 3, normalized_cq: -1.2, metric_payload: { source_file: "C01_run.csv", normalization_method: "delta_ct" } }),
      ],
      [
      { id: CENTRE, name: "AIIMS, Delhi", code: "C01" },
      ]
    )
    expect(csv.split("\r\n")).toEqual([
      "Centre_ID,Centre_Name,Collection_Date,Sample,Target,Cq,Cq_SD,Normalized_Cq,Copy_Number,Copy_Number_SD,Source_File,Normalization_Method",
      'C01,"AIIMS, Delhi",2026-10-01,WW-01,Target A,24.55,0.14,1.659,,,C01_run.csv,two_power_delta_ct',
      'C01,"AIIMS, Delhi",2026-10-01,,Target A,24.55,0.14,,1200.5,,C01_run.csv,',
      'C01,"AIIMS, Delhi",2026-10-01,WW-01,Target A,24.55,0.14,-1.2,,,C01_run.csv,delta_ct',
      "",
    ])
  })

  it("pages through every matching row with the filters applied", async () => {
    let page = 0
    const fake = fakeSupabase({
      "compiled_measurements.select": () => ({ data: Array.from({ length: page++ === 0 ? 1000 : 3 }, (_, i) => row({ id: i })) }),
    })
    const rows = await fetchAllCompiled(fake.client, "p", { centre: CENTRE, from: "2026-10-01", to: null, target: "Target A" })
    expect(rows).toHaveLength(1003)
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1].filters).toEqual(
      expect.arrayContaining([
        ["eq:project_id", "p"],
        ["eq:centre_id", CENTRE],
        ["eq:target_name", "Target A"],
        ["gte:collection_date", "2026-10-01"],
        ["range:1000", 1999],
      ])
    )
    expect(fake.calls[1].filters.some(([f]) => f.startsWith("lte:"))).toBe(false)
  })
})

describe("GET compiled export", () => {
  beforeEach(() => vi.clearAllMocks())

  it("downloads the filtered CSV for the project admin", async () => {
    mocks.auth.mockResolvedValue({ ok: true, context: { project: { id: "p", code: "PROJ" } } })
    const fake = fakeSupabase({
      "compiled_measurements.select": { data: [row()] },
      "centres.select": { data: [{ id: CENTRE, name: "AIIMS", code: "C01" }] },
    })
    mocks.client.mockResolvedValue(fake.client)

    const res = await exportRoute(new Request(`http://x/api/projects/PROJ/compiled/export?centre=${CENTRE}`), {
      params: Promise.resolve({ code: "PROJ" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename="PROJ_compiled_\d{4}-\d{2}-\d{2}\.csv"/)
    const text = await res.text()
    expect(text).toContain("C01,AIIMS,2026-10-01,WW-01,Target A")
    expect(mocks.auth).toHaveBeenCalledWith("PROJ", "data_compilation")
    expect(fake.calls[0].filters).toContainEqual(["eq:centre_id", CENTRE])
  })

  it("is refused when compilation is off or the user is not an admin", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ message: "off" }, { status: 403 }) })
    const res = await exportRoute(new Request("http://x"), { params: Promise.resolve({ code: "PROJ" }) })
    expect(res.status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
  })
})

describe("admin pages", () => {
  it("shows Approvals with data management and Compiled data only with data compilation", () => {
    const labels = (f: { data_management: boolean; data_compilation: boolean }) =>
      visiblePages(ADMIN_PAGES, { ...f, data_plotting: false }).map((p) => p.label)
    expect(labels({ data_management: true, data_compilation: false })).toContain("Approvals")
    expect(labels({ data_management: true, data_compilation: false })).not.toContain("Compiled data")
    expect(labels({ data_management: true, data_compilation: true })).toEqual(expect.arrayContaining(["Approvals", "Compiled data"]))
  })
})
