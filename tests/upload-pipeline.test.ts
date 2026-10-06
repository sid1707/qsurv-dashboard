import { readFileSync } from "node:fs"
import path from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { detectInstrument, projectInstruments } from "../lib/qpcr/instruments"
import { finalizeUploadSubmit, type FinalizeInput } from "../lib/upload/finalize"
import { buildUploadPath, isOwnUploadPath, toSafeFilename } from "../lib/upload/path"
import { canDeleteUpload, uploadStatus } from "../lib/upload/status"
import { buildValidationSetup, type ValidationSetup } from "../lib/validation/setup"
import { createMigratedDb } from "./db/harness"
import { fakeSupabase } from "./fake-supabase"

const RUNS = path.resolve(__dirname, "fixtures/runs")
const OK_FILE = "C01_HuwelLab_Pune_01102026_quantstudio5.csv"
const WRONG_LAYOUT_FILE = "C01_HuwelLab_Pune_01102026_quantstudio5_wrong-layout.csv"
const TWO_DATES_FILE = "C01_HuwelLab_Pune_01102026_08102026_two-dates.csv"
const CENTRE_NAME = { centreId: "C01", fileCode: "HuwelLab_Pune" }
const PROJECT = { id: "10000000-0000-4000-8000-000000000001", code: "HMP-PUNE" }
const CENTRE = "20000000-0000-4000-8000-000000000001"
const UPLOAD = "30000000-0000-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-000000000001"
const NOW = new Date("2026-10-05T00:00:00Z")

let setup: ValidationSetup

beforeAll(async () => {
  const db = await createMigratedDb()
  const { rows } = await db.query<{ kit: never }>(
    `select jsonb_build_object('id', k.id, 'name', k.name, 'version', k.version, 'layout_orientation', k.layout_orientation,
       'rule_defaults', k.rule_defaults,
       'kit_targets', (select jsonb_agg(to_jsonb(t)) from public.kit_targets t where t.kit_id = k.id)) as kit
     from public.kits k where k.name = 'Huwel Multipathogen'`
  )
  setup = buildValidationSetup(rows[0].kit, { plate_layout: null, qc_rules: null })
}, 60_000)

const ref = (kind: "results" | "runfile", filename: string) => ({
  bucket: "qsurv-files",
  storagePath: buildUploadPath(PROJECT.code, CENTRE, UPLOAD, kind, filename),
  originalFilename: filename,
  sizeBytes: 100,
})

/** A user client whose storage holds `csv`, and a service client, both recording writes. */
function clients(options: { csv?: string; batch?: Record<string, unknown> | null; peers?: unknown[] } = {}) {
  const user = fakeSupabase({
    "upload_batches.select": {
      data:
        options.batch === undefined
          ? { id: UPLOAD, upload_status: "draft", instrument: "quantstudio_5", sample_collection_date: "2026-10-01", sample_collection_dates: ["2026-10-01"] }
          : options.batch,
    },
    "upload_files.select": { data: options.peers ?? [] },
    "upload_files.upsert": { error: null },
  })
  const download = vi.fn(async () => ({ data: new Blob([options.csv ?? readFileSync(path.join(RUNS, OK_FILE), "utf8")]), error: null }))
  const userClient = { ...user.client, storage: { from: () => ({ download }) } } as unknown as SupabaseClient
  const service = fakeSupabase({
    "validation_runs.insert": { data: { id: "run-1" } },
    "validation_issues.insert": { error: null },
    "upload_batches.update": { error: null },
    "upload_split_artifacts.delete": { error: null },
    "upload_split_artifacts.insert": { error: null },
  })
  const upload = vi.fn(async (...args: unknown[]) => {
    void args
    return { error: null }
  })
  const serviceClient = { ...service.client, storage: { from: () => ({ upload }) } } as unknown as SupabaseClient
  return { user, userClient, service: { ...service, client: serviceClient }, download, upload }
}

function input(c: ReturnType<typeof clients>, overrides: Partial<FinalizeInput> = {}): FinalizeInput {
  return {
    supabase: c.userClient,
    service: c.service.client,
    project: PROJECT,
    centreId: CENTRE,
    centre: CENTRE_NAME,
    userId: USER,
    setup,
    uploadId: UPLOAD,
    results: ref("results", OK_FILE),
    runfile: ref("runfile", "C01_HuwelLab_Pune_01102026.eds"),
    warningAcknowledged: false,
    now: NOW,
    ...overrides,
  }
}

describe("finalizeUploadSubmit", () => {
  it("re-validates the stored file, records both files, the run and the batch status", async () => {
    const c = clients()
    const result = await finalizeUploadSubmit(input(c))
    expect(result).toEqual({ ok: true, runId: "run-1", warningCount: 0 })

    expect(c.download).toHaveBeenCalled()
    const upserts = c.user.calls.filter((call) => call.table === "upload_files" && call.op === "upsert")
    expect(upserts.map((u) => (u.args[0] as { file_kind: string }).file_kind)).toEqual(["results", "runfile"])
    expect((upserts[0].args[0] as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/)

    const run = c.service.calls.find((call) => call.table === "validation_runs" && call.op === "insert")
    expect(run?.args[0]).toMatchObject({ upload_batch_id: UPLOAD, passed: true, error_count: 0, engine_version: "qsurv-validation-1" })
    const issues = c.service.calls.find((call) => call.table === "validation_issues")
    expect(issues?.args[0]).toEqual([expect.objectContaining({ severity: "detail", message: "Export format: QuantStudio 5." }), expect.anything()])
    const update = c.service.calls.find((call) => call.table === "upload_batches" && call.op === "update")
    expect(update?.args[0]).toMatchObject({
      upload_status: "uploaded",
      processing_status: "completed",
      warning_acknowledged: false,
      split_mode: "none",
      logical_file_count: 1,
    })
    expect(c.upload).not.toHaveBeenCalled()
  })

  it("stores one file per sample for a multi-date plate and records the split", async () => {
    const { presetLayout } = await import("../lib/plate/layout")
    const twoDates = { ...setup, layout: presetLayout(setup.panel, { unknownReplicates: 3, pc: 1, nc: 1, samples: 2 }, "dates") }
    const c = clients({
      csv: readFileSync(path.join(RUNS, TWO_DATES_FILE), "utf8"),
      batch: { id: UPLOAD, upload_status: "draft", instrument: "quantstudio_5", sample_collection_date: "2026-10-01", sample_collection_dates: ["2026-10-01", "2026-10-08"] },
    })
    const result = await finalizeUploadSubmit(
      input(c, {
        setup: twoDates,
        results: ref("results", TWO_DATES_FILE),
        runfile: ref("runfile", "C01_HuwelLab_Pune_01102026_08102026.eds"),
        now: new Date("2026-10-10T00:00:00Z"),
      })
    )
    expect(result).toMatchObject({ ok: true })
    expect(c.upload.mock.calls.map((call) => call[0])).toEqual([
      `${PROJECT.code}/${CENTRE}/${UPLOAD}/splits/C01_HuwelLab_Pune_011026.csv`,
      `${PROJECT.code}/${CENTRE}/${UPLOAD}/splits/C01_HuwelLab_Pune_081026.csv`,
    ])
    const rows = c.service.calls.find((call) => call.table === "upload_split_artifacts" && call.op === "insert")?.args[0]
    expect(rows).toEqual([
      expect.objectContaining({ split_index: 0, split_mode: "by_date", display_filename: "C01_HuwelLab_Pune_011026.csv", collection_date: "2026-10-01" }),
      expect.objectContaining({ split_index: 1, split_mode: "by_date", display_filename: "C01_HuwelLab_Pune_081026.csv", collection_date: "2026-10-08" }),
    ])
    const update = c.service.calls.find((call) => call.table === "upload_batches" && call.op === "update")
    expect(update?.args[0]).toMatchObject({ split_mode: "by_date", logical_file_count: 2 })
  })

  it("rejects a sample already uploaded in an earlier multi-sample run", async () => {
    const { presetLayout } = await import("../lib/plate/layout")
    const twoDates = { ...setup, layout: presetLayout(setup.panel, { unknownReplicates: 3, pc: 1, nc: 1, samples: 2 }, "dates") }
    const c = clients({
      csv: readFileSync(path.join(RUNS, TWO_DATES_FILE), "utf8"),
      batch: { id: UPLOAD, upload_status: "draft", instrument: "quantstudio_5", sample_collection_date: "2026-10-01", sample_collection_dates: ["2026-10-01", "2026-10-08"] },
    })
    const userWithPeers = fakeSupabase({
      "upload_batches.select": { data: { id: UPLOAD, upload_status: "draft", instrument: "quantstudio_5", sample_collection_date: "2026-10-01", sample_collection_dates: ["2026-10-01", "2026-10-08"] } },
      "upload_files.select": { data: [] },
      "upload_split_artifacts.select": {
        data: [{ display_filename: "C01_HuwelLab_Pune_081026.csv", collection_date: "2026-10-08", upload_batches: { upload_status: "uploaded", is_active: true } }],
      },
    })
    const result = await finalizeUploadSubmit(
      input(c, {
        supabase: { ...userWithPeers.client, storage: c.userClient.storage } as unknown as SupabaseClient,
        setup: twoDates,
        results: ref("results", TWO_DATES_FILE),
        runfile: ref("runfile", "C01_HuwelLab_Pune_01102026_08102026.eds"),
        now: new Date("2026-10-10T00:00:00Z"),
      })
    )
    expect(result).toMatchObject({ ok: false, code: "DUPLICATE_UPLOAD", message: expect.stringMatching(/C01_HuwelLab_Pune_081026.csv/) })
  })

  it("blocks the wrong-layout file and leaves the batch a draft", async () => {
    const c = clients({ csv: readFileSync(path.join(RUNS, WRONG_LAYOUT_FILE), "utf8") })
    const result = await finalizeUploadSubmit(input(c, { results: ref("results", WRONG_LAYOUT_FILE) }))
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" })
    if (result.ok) return
    expect(result.issues?.filter((i) => i.errorCode === "WRONG_WELL_ROLE")).toHaveLength(4)
    expect(c.user.calls.some((call) => call.op === "upsert")).toBe(false)
    expect(c.service.calls).toEqual([])
  })

  it("asks for confirmation of warnings, then records the acknowledgement", async () => {
    const csv = readFileSync(path.join(RUNS, OK_FILE), "utf8").replace(",Target A,NTC,FAM,NFQ-MGB,Undetermined", ",Target A,NTC,FAM,NFQ-MGB,30.1")
    const first = await finalizeUploadSubmit(input(clients({ csv })))
    expect(first).toMatchObject({ ok: false, code: "WARNINGS_REQUIRE_ACK" })

    const c = clients({ csv })
    expect(await finalizeUploadSubmit(input(c, { warningAcknowledged: true }))).toMatchObject({ ok: true, warningCount: 1 })
    const update = c.service.calls.find((call) => call.table === "upload_batches")
    expect(update?.args[0]).toMatchObject({ warning_acknowledged: true })
  })

  it("rejects the same file submitted again by the centre, ignoring rejected uploads", async () => {
    const csv = readFileSync(path.join(RUNS, OK_FILE), "utf8")
    const { createHash } = await import("node:crypto")
    const sha256 = createHash("sha256").update(csv).digest("hex")
    const peer = (status: string) => ({
      upload_batch_id: "other",
      original_filename: "earlier.csv",
      sha256,
      upload_batches: { upload_status: status, is_active: true, sample_collection_date: "2026-09-01" },
    })

    expect(await finalizeUploadSubmit(input(clients({ peers: [peer("uploaded")] })))).toMatchObject({
      ok: false,
      code: "DUPLICATE_UPLOAD",
      message: "Duplicate entry detected: this file was already uploaded by your centre (as 'earlier.csv').",
    })
    expect((await finalizeUploadSubmit(input(clients({ peers: [peer("rejected")] })))).ok).toBe(true)
  })

  it("checks the run file belongs to the instrument and the run", async () => {
    const result = await finalizeUploadSubmit(input(clients(), { runfile: ref("runfile", "C01_HuwelLab_Pune_01102026.pcrd") }))
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" })
    if (!result.ok) expect(result.issues?.[0].errorCode).toBe("RUNFILE_EXTENSION")
  })

  it("only accepts files stored in this upload's own folder", async () => {
    const elsewhere = { ...ref("results", OK_FILE), storagePath: `${PROJECT.code}/other-centre/${UPLOAD}/results/${OK_FILE}` }
    expect(await finalizeUploadSubmit(input(clients(), { results: elsewhere }))).toMatchObject({ ok: false, code: "INVALID_FILE_REF" })
  })

  it("refuses batches that are missing, already submitted, or cannot be processed", async () => {
    expect(await finalizeUploadSubmit(input(clients({ batch: null })))).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" })
    expect(
      await finalizeUploadSubmit(input(clients({ batch: { id: UPLOAD, upload_status: "uploaded", instrument: "quantstudio_5", sample_collection_date: null, sample_collection_dates: null } })))
    ).toMatchObject({ ok: false, code: "ALREADY_SUBMITTED" })
    expect(await finalizeUploadSubmit(input(clients(), { service: null }))).toMatchObject({ ok: false, code: "PROCESSING_UNAVAILABLE" })
  })
})

describe("storage paths", () => {
  it("keeps every file under <project>/<centre>/<upload>/<kind>/ with a safe name", () => {
    expect(buildUploadPath("HMP-PUNE", "c1", "u1", "results", "My Run (1).csv")).toBe("HMP-PUNE/c1/u1/results/My_Run__1_.csv")
    expect(toSafeFilename("../../etc/passwd")).toBe(".._.._etc_passwd")
  })

  it("rejects refs outside the upload's folder or bucket", () => {
    const good = { bucket: "qsurv-files", storagePath: "HMP-PUNE/c1/u1/results/a.csv" }
    expect(isOwnUploadPath(good, "HMP-PUNE", "c1", "u1", "results")).toBe(true)
    expect(isOwnUploadPath(good, "HMP-PUNE", "c1", "u1", "runfile")).toBe(false)
    expect(isOwnUploadPath({ ...good, bucket: "other" }, "HMP-PUNE", "c1", "u1", "results")).toBe(false)
    expect(isOwnUploadPath({ ...good, storagePath: "HMP-PUNE/c1/u1/results/x/a.csv" }, "HMP-PUNE", "c1", "u1", "results")).toBe(false)
  })
})

describe("upload status for centre users", () => {
  const batch = (upload_status: string, approval_status = "pending", processing_status: string | null = null) => ({
    upload_status,
    approval_status,
    processing_status,
  })

  it("collapses the three status columns into one label", () => {
    expect(uploadStatus(batch("draft")).label).toBe("Not submitted")
    expect(uploadStatus(batch("uploaded", "pending", "completed")).label).toBe("Awaiting approval")
    expect(uploadStatus(batch("queued", "pending", "queued")).label).toBe("Processing")
    expect(uploadStatus(batch("uploaded", "approved", "completed")).label).toBe("Approved")
    expect(uploadStatus(batch("compiled", "approved", "completed")).label).toBe("Compiled")
    expect(uploadStatus(batch("uploaded", "rejected")).label).toBe("Rejected")
    expect(uploadStatus(batch("uploaded", "pending", "failed")).label).toBe("Processing failed")
  })

  it("allows deleting only before the admin decides", () => {
    expect(canDeleteUpload(batch("draft"))).toBe(true)
    expect(canDeleteUpload(batch("uploaded", "pending", "completed"))).toBe(true)
    expect(canDeleteUpload(batch("uploaded", "approved"))).toBe(false)
    expect(canDeleteUpload(batch("uploaded", "rejected"))).toBe(false)
  })
})

describe("instruments", () => {
  it("uses the instruments chosen at onboarding, falling back to the legacy column", () => {
    expect(projectInstruments({ instruments: ["quantstudio_5", "biorad_cfx96"], instrument: null })).toEqual(["quantstudio_5", "biorad_cfx96"])
    expect(projectInstruments({ instruments: null, instrument: "biorad_cfx96" })).toEqual(["biorad_cfx96"])
    expect(projectInstruments({ instruments: null, instrument: null })).toEqual(["other"])
  })

  it("recognises QuantStudio and CFX exports from their headers", () => {
    expect(detectInstrument(["Well", "Well Position", "Sample Name", "Target Name", "Task", "Reporter", "CT"])).toBe("quantstudio_5")
    expect(detectInstrument(["", "Well", "Fluor", "Target", "Content", "Sample", "Cq"])).toBe("biorad_cfx96")
    expect(detectInstrument(["Well", "Sample", "Target", "Dye", "Ct"])).toBeNull()
  })
})
