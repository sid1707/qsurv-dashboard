import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildValidationSetup } from "../lib/validation/setup"

const RUNS = path.resolve(__dirname, "fixtures/runs")

const mocks = vi.hoisted(() => ({ context: vi.fn(), setup: vi.fn() }))
vi.mock("@/lib/upload/centre-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/upload/centre-context")>()),
  getCentreUploadContext: mocks.context,
}))
vi.mock("@/lib/validation/setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/validation/setup")>()),
  loadValidationSetup: mocks.setup,
}))

import { POST as validate } from "../app/api/uploads/validate/route"
import { POST as start } from "../app/api/uploads/start/route"

// The Huwel Multipathogen panel, as seeded (one tube; preset layout).
const kitRow = {
  id: "k",
  name: "Huwel Multipathogen",
  version: "0.1-placeholder",
  layout_orientation: "tubes_in_rows",
  rule_defaults: {},
  kit_targets: [
    ["Target A", ["TGT-A"], "FAM", "none", 12, 38, 1],
    ["Target B", ["TGT-B"], "HEX", "none", 12, 38, 2],
    ["Internal Control", ["IC"], "Cy5", "internal_control", 18, 32, 3],
  ].map(([target_name, aliases, fluorophore, control_type, ct_min, ct_max, sort_order]) => ({
    target_name,
    aliases,
    fluorophore,
    control_type,
    ct_min,
    ct_max,
    sort_order,
    tube_name: "Tube 1",
    tube_order: 1,
    std_slope: null,
  })),
} as never

function context(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    context: {
      userId: "u",
      project: { id: "p", code: "HMP-PUNE", kit_id: "k", plate_layout: null, qc_rules: null },
      centre: { id: "c", name: "Centre", active: true, code: "C01", file_code: "HuwelLab_Pune" },
      instruments: ["quantstudio_5"],
      supabase: {},
      ...overrides,
    },
  }
}

function validateRequest(filename: string, fields: Record<string, string> = {}) {
  const form = new FormData()
  form.set("projectCode", "HMP-PUNE")
  form.set("results", new File([readFileSync(path.join(RUNS, filename))], filename, { type: "text/csv" }))
  form.set("runFilename", "C01_HuwelLab_Pune_01102026.eds")
  form.set("instrument", "quantstudio_5")
  form.set("sampleCollectionDates", "01/10/2026")
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request("http://localhost/api/uploads/validate", { method: "POST", body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue(context())
  mocks.setup.mockResolvedValue(buildValidationSetup(kitRow, { plate_layout: null, qc_rules: null }))
})

describe("POST /api/uploads/validate", () => {
  it("passes the sample QuantStudio run for the placeholder kit", async () => {
    const res = await validate(validateRequest("C01_HuwelLab_Pune_01102026_quantstudio5.csv"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ passed: true, hasBlockingErrors: false, hasWarnings: false, issues: [] })
  })

  it("returns the layout errors for the wrong-layout run", async () => {
    const res = await validate(validateRequest("C01_HuwelLab_Pune_01102026_quantstudio5_wrong-layout.csv"))
    const body = await res.json()
    expect(body).toMatchObject({ passed: false, hasBlockingErrors: true, errorCount: 4 })
    expect(body.issues.map((i: { well: string }) => i.well)).toEqual(["A1", "A2", "A4", "A5"])
  })

  it("only accepts the project's own instruments", async () => {
    const res = await validate(validateRequest("C01_HuwelLab_Pune_01102026_quantstudio5.csv", { instrument: "biorad_cfx96" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_INSTRUMENT" })
  })

  it("refuses people who are not centre users of the project", async () => {
    mocks.context.mockResolvedValue({ ok: false, reason: "not_centre_user" })
    const res = await validate(validateRequest("C01_HuwelLab_Pune_01102026_quantstudio5.csv"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "AUTH_FORBIDDEN", message: "Only centre users of this project can upload runs." })
  })
})

describe("POST /api/uploads/validate (multi-sample plates)", () => {
  it("blocks a run without sample identifiers and returns the reason to the form", async () => {
    const setup = buildValidationSetup(kitRow, { plate_layout: null, qc_rules: null })
    const { presetLayout } = await import("../lib/plate/layout")
    mocks.setup.mockResolvedValue({ ...setup, layout: presetLayout(setup.panel, { unknownReplicates: 3, pc: 1, nc: 1, samples: 2 }, "dates") })

    const name = "C01_HuwelLab_Pune_01102026_08102026_two-dates.csv"
    const csv = readFileSync(path.join(RUNS, name), "utf8").replaceAll(",WW_01102026,", ",WW,").replaceAll(",WW_08102026,", ",WW,")
    const form = new FormData()
    form.set("projectCode", "HMP-PUNE")
    form.set("results", new File([csv], name, { type: "text/csv" }))
    form.set("runFilename", "C01_HuwelLab_Pune_01102026_08102026.eds")
    form.set("instrument", "quantstudio_5")
    form.append("sampleCollectionDates", "01/10/2026")
    form.append("sampleCollectionDates", "08/10/2026")
    const res = await validate(new Request("http://localhost/api/uploads/validate", { method: "POST", body: form }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ passed: false, hasBlockingErrors: true, errorCount: 1 })
    expect(body.issues[0]).toMatchObject({ errorCode: "NO_IDENTIFIER_DATES", severity: "error" })
  })
})

describe("POST /api/uploads/start (dates)", () => {
  it("asks for one date per sample when plates carry samples from several dates", async () => {
    const setup = buildValidationSetup(kitRow, { plate_layout: null, qc_rules: null })
    const { presetLayout } = await import("../lib/plate/layout")
    mocks.setup.mockResolvedValue({ ...setup, layout: presetLayout(setup.panel, { unknownReplicates: 3, pc: 1, nc: 1, samples: 2 }, "dates") })
    const res = await start(
      new Request("http://localhost/api/uploads/start", {
        method: "POST",
        body: JSON.stringify({ projectCode: "HMP-PUNE", instrument: "quantstudio_5", sampleCollectionDates: ["01/10/2026"] }),
      })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "MISSING_PLATE_DATES", message: "Enter 2 different collection dates, one per sample on the plate." })
  })

  it("refuses a centre without a centre ID", async () => {
    mocks.context.mockResolvedValue({ ok: false, reason: "centre_id_missing" })
    const res = await start(new Request("http://localhost/api/uploads/start", { method: "POST", body: "{}" }))
    expect(await res.json()).toMatchObject({ message: expect.stringMatching(/no centre ID yet/) })
  })
})

describe("POST /api/uploads/start", () => {
  it("creates a draft scoped to the user's own centre and the project's kit", async () => {
    const single = vi.fn(async () => ({ data: { id: "batch-1", upload_status: "draft", created_at: "now" }, error: null }))
    const insert = vi.fn(() => ({ select: () => ({ single }) }))
    mocks.context.mockResolvedValue(context({ supabase: { from: () => ({ insert }) } }))

    const res = await start(
      new Request("http://localhost/api/uploads/start", {
        method: "POST",
        body: JSON.stringify({ projectCode: "HMP-PUNE", instrument: "quantstudio_5", sampleCollectionDates: ["01/10/2026"], centreId: "someone-else" }),
      })
    )
    expect(await res.json()).toMatchObject({ uploadId: "batch-1" })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "p",
        centre_id: "c",
        kit_id: "k",
        uploaded_by: "u",
        sample_collection_date: "2026-10-01",
        sample_collection_dates: ["2026-10-01"],
        upload_status: "draft",
      })
    )
  })

  it("refuses a deactivated centre", async () => {
    mocks.context.mockResolvedValue({ ok: false, reason: "centre_inactive" })
    const res = await start(new Request("http://localhost/api/uploads/start", { method: "POST", body: "{}" }))
    expect(res.status).toBe(403)
  })
})
