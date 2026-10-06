import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
import { fakeSupabase } from "./fake-supabase"
import { approveUpload, rejectUpload, type ApproveProject } from "../lib/compile/approve"
import { listApprovalQueue } from "../lib/project-admin/approvals"

const RUN = readFileSync(path.resolve(__dirname, "fixtures/runs/C01_HuwelLab_Pune_01102026_quantstudio5.csv"), "utf8")
const UPLOAD = "30000000-0000-4000-8000-000000000001"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }))
vi.mock("@/lib/project-admin/api-auth", () => ({ requireProjectAdminApi: mocks.auth }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))

import { POST as approveRoute } from "../app/api/projects/[code]/uploads/[uploadId]/approve/route"
import { POST as rejectRoute } from "../app/api/projects/[code]/uploads/[uploadId]/reject/route"

const kitRow = {
  id: "k",
  name: "Huwel Multipathogen",
  version: "test",
  layout_orientation: "tubes_in_rows",
  rule_defaults: {},
  kit_targets: [
    ["ta", "Target A", "FAM", "none", 1],
    ["tb", "Target B", "HEX", "none", 2],
    ["ic", "Internal Control", "Cy5", "endogenous_control", 3],
  ].map(([id, target_name, fluorophore, control_type, sort_order]) => ({
    id,
    target_name,
    aliases: [],
    fluorophore,
    control_type,
    ct_min: null,
    ct_max: null,
    sort_order,
    tube_name: "Tube 1",
    tube_order: 1,
    std_slope: null,
    std_intercept: null,
  })),
}

const project = (overrides: Partial<ApproveProject> = {}): ApproveProject => ({
  id: "p",
  kit_id: "k",
  data_compilation: true,
  plate_layout: null,
  compile_rules: null,
  ...overrides,
})

const readyBatch = (overrides: Record<string, unknown> = {}) => ({
  id: UPLOAD,
  approval_status: "pending",
  upload_status: "uploaded",
  processing_status: "completed",
  is_active: true,
  sample_collection_date: "2026-10-01",
  split_mode: "none",
  upload_files: [{ file_kind: "results", original_filename: "C01_run.csv", storage_bucket: "qsurv-files", storage_path: "P/c/u/results/run.csv" }],
  upload_split_artifacts: [],
  ...overrides,
})

function db(batch: unknown = readyBatch(), files: Record<string, string> = { "qsurv-files/P/c/u/results/run.csv": RUN }) {
  const fake = fakeSupabase({ "upload_batches.select": { data: batch }, "kits.select": { data: kitRow } }, files)
  fake.rpc.mockImplementation(async (name: string, params?: unknown) => {
    const rows = (params as { p_measurements?: unknown[] })?.p_measurements ?? []
    return { data: name === "approve_upload" ? { already_approved: false, rows_written: rows.length } : null, error: null }
  })
  return fake
}

describe("approveUpload", () => {
  it("compiles the stored run and approves it with the rows in one call", async () => {
    const fake = db()
    const result = await approveUpload(fake.client, project(), UPLOAD)
    expect(result).toEqual({ ok: true, rowsWritten: 3, alreadyApproved: false, compileSkipped: false, compileNotes: null })

    const [name, params] = fake.rpc.mock.calls[0] as [string, { p_measurements: Record<string, unknown>[]; p_compile_notes: string | null }]
    expect(name).toBe("approve_upload")
    expect(params.p_measurements.map((m) => [m.kit_target_id, m.target_name, m.collection_date])).toEqual([
      ["ta", "Target A", "2026-10-01"],
      ["tb", "Target B", "2026-10-01"],
      ["ic", "Internal Control", "2026-10-01"],
    ])
    // Scoped to the project, never trusting the upload id alone.
    expect(fake.calls[0].filters).toContainEqual(["eq:project_id", "p"])
  })

  it("approves without compiling when data compilation is off", async () => {
    const fake = db()
    const result = await approveUpload(fake.client, project({ data_compilation: false }), UPLOAD)
    expect(result).toMatchObject({ ok: true, rowsWritten: 0, compileSkipped: false })
    expect(fake.rpc).toHaveBeenCalledWith("approve_upload", { p_upload_id: UPLOAD, p_measurements: [], p_compile_notes: null })
    expect(fake.calls.some((c) => c.table === "kits")).toBe(false)
  })

  it("approves with a note when every sample fails the endogenous gate", async () => {
    const diluted = RUN.replaceAll(/Internal Control,UNKNOWN,CY5,NFQ-MGB,[\d.]+/g, "Internal Control,UNKNOWN,CY5,NFQ-MGB,38")
    const fake = db(readyBatch(), { "qsurv-files/P/c/u/results/run.csv": diluted })
    const result = await approveUpload(fake.client, project(), UPLOAD)
    expect(result).toMatchObject({ ok: true, rowsWritten: 0, compileSkipped: true })
    expect(result.ok && result.compileNotes).toMatch(/mean Internal Control Ct is 38.00[\s\S]*no data was compiled/)
  })

  it("compiles a multi-sample run from its split files, each with its own date", async () => {
    const batch = readyBatch({
      split_mode: "by_date",
      upload_split_artifacts: [
        { split_index: 2, display_filename: "b.csv", collection_date: "2026-10-08", split_key: "08102026", storage_bucket: "qsurv-files", storage_path: "s/b.csv" },
        { split_index: 1, display_filename: "a.csv", collection_date: "2026-10-01", split_key: "01102026", storage_bucket: "qsurv-files", storage_path: "s/a.csv" },
      ],
    })
    const fake = db(batch, { "qsurv-files/s/a.csv": RUN, "qsurv-files/s/b.csv": RUN })
    expect(await approveUpload(fake.client, project(), UPLOAD)).toMatchObject({ ok: true, rowsWritten: 6 })
    const rows = (fake.rpc.mock.calls[0][1] as { p_measurements: { collection_date: string; metric_payload: { source_file: string } }[] }).p_measurements
    expect(rows.map((r) => `${r.collection_date} ${r.metric_payload.source_file}`)).toEqual([
      ...Array(3).fill("2026-10-01 a.csv"),
      ...Array(3).fill("2026-10-08 b.csv"),
    ])
  })

  it("does not approve when the file cannot be compiled or read", async () => {
    let fake = db(readyBatch(), { "qsurv-files/P/c/u/results/run.csv": "garbage" })
    expect(await approveUpload(fake.client, project(), UPLOAD)).toMatchObject({ ok: false, code: "COMPILE_FAILED" })
    expect(fake.rpc).not.toHaveBeenCalled()

    fake = db(readyBatch(), {})
    expect(await approveUpload(fake.client, project(), UPLOAD)).toMatchObject({ ok: false, code: "COMPILE_FAILED", message: /Could not read C01_run.csv/ })
  })

  it("answers for uploads that are missing, already reviewed or not ready", async () => {
    expect(await approveUpload(db(null).client, project(), UPLOAD)).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(await approveUpload(db().client, project(), "not-a-uuid")).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(await approveUpload(db(readyBatch({ approval_status: "approved" })).client, project(), UPLOAD)).toMatchObject({ ok: true, alreadyApproved: true })
    expect(await approveUpload(db(readyBatch({ approval_status: "rejected" })).client, project(), UPLOAD)).toMatchObject({ ok: false, code: "NOT_READY" })
    expect(await approveUpload(db(readyBatch({ processing_status: "failed" })).client, project(), UPLOAD)).toMatchObject({ ok: false, code: "NOT_READY" })
  })

  it("passes the database's reason through", async () => {
    const fake = db()
    fake.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Validation did not pass; cannot approve." } })
    expect(await approveUpload(fake.client, project(), UPLOAD)).toEqual({
      ok: false,
      code: "NOT_READY",
      message: "Validation did not pass; cannot approve.",
    })
  })
})

describe("rejectUpload", () => {
  it("needs a reason and calls reject_upload", async () => {
    const fake = db({ id: UPLOAD })
    expect(await rejectUpload(fake.client, "p", UPLOAD, "   ")).toMatchObject({ ok: false })
    expect(await rejectUpload(fake.client, "p", UPLOAD, " Wrong date ")).toEqual({ ok: true })
    expect(fake.rpc).toHaveBeenCalledWith("reject_upload", { p_upload_id: UPLOAD, p_reason: "Wrong date" })
  })

  it("does not reject an upload of another project", async () => {
    const fake = db(null)
    expect(await rejectUpload(fake.client, "p", UPLOAD, "x")).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(fake.rpc).not.toHaveBeenCalled()
  })
})

describe("review routes", () => {
  const params = (uploadId = UPLOAD) => ({ params: Promise.resolve({ code: "PROJ", uploadId }) })
  const admin = (overrides: Partial<ApproveProject> = {}) => ({
    ok: true,
    context: { project: { ...project(overrides), code: "PROJ" }, features: {} },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(admin())
  })

  it("approves for the project admin and reports the compiled rows", async () => {
    mocks.client.mockResolvedValue(db().client)
    const res = await approveRoute(new Request("http://x", { method: "POST" }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: "approved", rowsWritten: 3, compiled: true, compileSkipped: false })
    expect(mocks.auth).toHaveBeenCalledWith("PROJ", "data_management")
  })

  it("passes the auth refusal through", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ message: "no" }, { status: 403 }) })
    const res = await approveRoute(new Request("http://x", { method: "POST" }), params())
    expect(res.status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it("maps not-ready uploads to 409", async () => {
    mocks.client.mockResolvedValue(db(readyBatch({ upload_status: "draft" })).client)
    const res = await approveRoute(new Request("http://x", { method: "POST" }), params())
    expect(res.status).toBe(409)
  })

  it("rejects with a reason, and refuses without one", async () => {
    const fake = db({ id: UPLOAD })
    mocks.client.mockResolvedValue(fake.client)
    const post = (body: unknown) =>
      rejectRoute(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), params())
    expect((await post({})).status).toBe(400)
    const res = await post({ reason: "Wrong plate" })
    expect(res.status).toBe(200)
    expect(fake.rpc).toHaveBeenCalledWith("reject_upload", { p_upload_id: UPLOAD, p_reason: "Wrong plate" })
  })
})

describe("listApprovalQueue", () => {
  it("lists passed, submitted uploads with their warnings", async () => {
    const fake = fakeSupabase({
      "upload_batches.select": {
        data: [
          {
            id: "b1",
            submitted_at: "2026-10-02T05:00:00Z",
            centre_id: "c1",
            instrument: "quantstudio_5",
            sample_collection_date: "2026-10-01",
            sample_collection_dates: null,
            split_mode: "none",
            logical_file_count: 1,
            notes: null,
            warning_acknowledged: true,
            centres: { name: "AIIMS", code: "C01" },
            uploader: { full_name: "Asha" },
            upload_files: [
              { file_kind: "results", original_filename: "C01_x.csv" },
              { file_kind: "runfile", original_filename: "C01_x.eds" },
            ],
            upload_split_artifacts: [],
            validation_runs: [
              { id: "old", passed: false, created_at: "2026-10-01T00:00:00Z" },
              { id: "r1", passed: true, created_at: "2026-10-02T00:00:00Z" },
            ],
          },
          {
            id: "b2",
            submitted_at: null,
            centre_id: "c1",
            centres: null,
            uploader: null,
            upload_files: [],
            upload_split_artifacts: [],
            validation_runs: [{ id: "r2", passed: false, created_at: "2026-10-02T00:00:00Z" }],
          },
        ],
      },
      "validation_issues.select": { data: [{ validation_run_id: "r1", severity: "warning", issue_code: "LOW_CT_THRESHOLD", message: "Low Ct" }] },
    })
    const items = await listApprovalQueue(fake.client, "p")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: "b1",
      centreCode: "C01",
      centreName: "AIIMS",
      uploaderName: "Asha",
      collectionDates: ["2026-10-01"],
      resultsFilename: "C01_x.csv",
      runFilename: "C01_x.eds",
      warningAcknowledged: true,
      warnings: [{ severity: "warning", issue_code: "LOW_CT_THRESHOLD", message: "Low Ct" }],
    })
    const batches = fake.calls.find((c) => c.table === "upload_batches")!
    expect(batches.filters).toEqual(
      expect.arrayContaining([
        ["eq:project_id", "p"],
        ["eq:approval_status", "pending"],
        ["eq:upload_status", "uploaded"],
      ])
    )
  })
})
