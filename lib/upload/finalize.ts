import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isInstrumentId } from "@/lib/qpcr/instruments"
import { checkRun, splitValidationIssues, type RunCheckResult } from "@/lib/upload/run-check"
import { UPLOAD_BUCKET, buildUploadPath, isOwnUploadPath, type UploadFileKind } from "@/lib/upload/path"
import { RESULTS_MAX_BYTES } from "@/lib/upload/client-types"
import type { CentreFileIdentity } from "@/lib/validation/filename"
import type { ValidationSetup } from "@/lib/validation/setup"
import { ENGINE_VERSION, type ValidationIssue, type ValidationResult } from "@/lib/validation/types"

/**
 * Submit, from vrdl-next-platform lib/upload/finalize-upload-submit.ts and the
 * submit route: re-validate the stored export, block duplicates, record the
 * files, then (with the service role, since centre users cannot write
 * validation results) store the split files of a multi-sample run, the
 * validation run, and mark the batch uploaded. A batch that fails stays a
 * draft, so the centre can fix the file and retry.
 */

export type UploadFileRef = {
  bucket: string
  storagePath: string
  originalFilename: string
  sizeBytes?: number | null
  mimeType?: string | null
}

export type FinalizeCode =
  | "PROCESSING_UNAVAILABLE"
  | "BATCH_NOT_FOUND"
  | "ALREADY_SUBMITTED"
  | "INVALID_FILE_REF"
  | "CSV_READ_FAILED"
  | "VALIDATION_FAILED"
  | "WARNINGS_REQUIRE_ACK"
  | "DUPLICATE_UPLOAD"
  | "DB_WRITE_FAILED"

export type FinalizeResult =
  | { ok: true; runId: string; warningCount: number }
  | { ok: false; code: FinalizeCode; message: string; issues?: ValidationIssue[]; details?: string[] }

export const FINALIZE_HTTP_STATUS: Record<FinalizeCode, number> = {
  PROCESSING_UNAVAILABLE: 503,
  BATCH_NOT_FOUND: 404,
  ALREADY_SUBMITTED: 409,
  INVALID_FILE_REF: 400,
  CSV_READ_FAILED: 400,
  VALIDATION_FAILED: 400,
  WARNINGS_REQUIRE_ACK: 409,
  DUPLICATE_UPLOAD: 400,
  DB_WRITE_FAILED: 500,
}

export type FinalizeInput = {
  /** The centre user's client: RLS applies to every read and file record. */
  supabase: SupabaseClient
  /** Service role, for validation results and status. Null when not configured. */
  service: SupabaseClient | null
  project: { id: string; code: string }
  centreId: string
  /** The centre's ID and file code, for the file name rules. */
  centre: CentreFileIdentity
  userId: string
  setup: ValidationSetup
  uploadId: string
  results: UploadFileRef
  runfile: UploadFileRef | null
  warningAcknowledged: boolean
  now?: Date
}

type Batch = {
  id: string
  upload_status: string
  instrument: string | null
  sample_collection_date: string | null
  sample_collection_dates: string[] | null
}

const batchDates = (b: Batch) =>
  (b.sample_collection_dates?.length ? b.sample_collection_dates : b.sample_collection_date ? [b.sample_collection_date] : []).map((d) =>
    d.slice(0, 10)
  )

export async function finalizeUploadSubmit(input: FinalizeInput): Promise<FinalizeResult> {
  const { supabase, service, project, centreId, uploadId, setup } = input

  if (!service) {
    return {
      ok: false,
      code: "PROCESSING_UNAVAILABLE",
      message: "Uploads cannot be processed on this server right now (SUPABASE_SERVICE_ROLE_KEY is missing). Your files were saved; try again later.",
    }
  }

  const { data: batch } = await supabase
    .from("upload_batches")
    .select("id, upload_status, instrument, sample_collection_date, sample_collection_dates")
    .eq("id", uploadId)
    .eq("project_id", project.id)
    .eq("centre_id", centreId)
    .eq("uploaded_by", input.userId)
    .maybeSingle<Batch>()
  if (!batch) return { ok: false, code: "BATCH_NOT_FOUND", message: "Upload batch not found." }
  if (batch.upload_status !== "draft") {
    return { ok: false, code: "ALREADY_SUBMITTED", message: "This upload was already submitted. Check My uploads before uploading again." }
  }

  const refs: [UploadFileKind, UploadFileRef | null][] = [
    ["results", input.results],
    ["runfile", input.runfile],
  ]
  for (const [kind, ref] of refs) {
    if (ref && !isOwnUploadPath(ref, project.code, centreId, uploadId, kind)) {
      return { ok: false, code: "INVALID_FILE_REF", message: "The uploaded file is not in this upload's folder." }
    }
  }

  const { data: blob, error: downloadError } = await supabase.storage.from(input.results.bucket).download(input.results.storagePath)
  if (downloadError || !blob) {
    return { ok: false, code: "CSV_READ_FAILED", message: downloadError?.message ?? "Could not read the uploaded results file." }
  }
  if (blob.size > RESULTS_MAX_BYTES) {
    return { ok: false, code: "CSV_READ_FAILED", message: "The results export is larger than 5 MB. Check you chose the right file." }
  }
  const csvText = await blob.text()
  const sha256 = createHash("sha256").update(csvText).digest("hex")

  const result = checkRun(setup, {
    filename: input.results.originalFilename,
    csvText,
    instrument: isInstrumentId(batch.instrument) ? batch.instrument : "other",
    sampleDates: batchDates(batch),
    runFilename: input.runfile?.originalFilename ?? null,
    centre: input.centre,
    now: input.now,
  })

  if (setup.rules.duplicate_upload?.enabled) {
    const duplicate = await findDuplicateUpload(supabase, {
      projectId: project.id,
      centreId,
      uploadId,
      sha256,
      filename: input.results.originalFilename,
      collectionDate: batch.sample_collection_date,
      splits: result.splitMode === "none" ? [] : result.artifacts,
    })
    if (duplicate) return { ok: false, code: "DUPLICATE_UPLOAD", message: duplicate }
  }

  const { errors, warnings } = splitValidationIssues(result.issues)
  if (errors.length > 0) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Validation failed; fix the file and upload it again.", issues: result.issues, details: result.details }
  }
  if (warnings.length > 0 && !input.warningAcknowledged) {
    return { ok: false, code: "WARNINGS_REQUIRE_ACK", message: "Validation produced warnings; confirm to proceed.", issues: result.issues, details: result.details }
  }

  for (const [kind, ref] of refs) {
    if (!ref) continue
    const { error } = await supabase.from("upload_files").upsert(
      {
        upload_batch_id: uploadId,
        project_id: project.id,
        centre_id: centreId,
        file_kind: kind,
        original_filename: ref.originalFilename,
        storage_bucket: ref.bucket,
        storage_path: ref.storagePath,
        sha256: kind === "results" ? sha256 : null,
        size_bytes: ref.sizeBytes ?? null,
        mime_type: ref.mimeType ?? null,
      },
      { onConflict: "upload_batch_id,file_kind" }
    )
    if (error) return { ok: false, code: "DB_WRITE_FAILED", message: error.message }
  }

  if (result.splitMode !== "none") {
    const stored = await storeSplitArtifacts(service, { project, centreId, uploadId, result })
    if (stored) return { ok: false, code: "DB_WRITE_FAILED", message: stored }
  }

  return recordValidation(service, {
    projectId: project.id,
    centreId,
    uploadId,
    result,
    acknowledged: input.warningAcknowledged,
    split: { mode: result.splitMode, count: result.splitMode === "none" ? 1 : result.artifacts.length },
  })
}

/**
 * Writes each sample's CSV to <upload>/splits/ and records it, replacing any
 * earlier attempt (vrdl-next-platform lib/upload/split-persist.ts). Returns an
 * error message, or null.
 */
async function storeSplitArtifacts(
  service: SupabaseClient,
  r: { project: { id: string; code: string }; centreId: string; uploadId: string; result: RunCheckResult }
): Promise<string | null> {
  const { error: clearError } = await service.from("upload_split_artifacts").delete().eq("upload_batch_id", r.uploadId)
  if (clearError) return `Could not clear earlier split files: ${clearError.message}`

  const rows = []
  for (const artifact of r.result.artifacts) {
    const path = buildUploadPath(r.project.code, r.centreId, r.uploadId, "splits", artifact.filename)
    const { error } = await service.storage
      .from(UPLOAD_BUCKET)
      .upload(path, new Blob([artifact.csvText], { type: "text/csv" }), { upsert: true })
    if (error) return `Split file ${artifact.filename} could not be stored: ${error.message}`
    rows.push({
      upload_batch_id: r.uploadId,
      project_id: r.project.id,
      centre_id: r.centreId,
      split_index: artifact.splitIndex,
      split_mode: artifact.splitMode,
      split_key: artifact.splitKey,
      display_filename: artifact.filename,
      collection_date: artifact.collectionDateYmd,
      storage_bucket: UPLOAD_BUCKET,
      storage_path: path,
    })
  }
  const { error } = await service.from("upload_split_artifacts").insert(rows)
  return error ? `Could not save split files: ${error.message}` : null
}

/**
 * Another active, submitted upload from the same centre with the same file
 * contents, or the same file name for the same collection date.
 */
export async function findDuplicateUpload(
  supabase: SupabaseClient,
  q: {
    projectId: string
    centreId: string
    uploadId: string
    sha256: string
    filename: string
    collectionDate: string | null
    /** Split files of this upload: each must not repeat an earlier split for the same date. */
    splits?: { filename: string; collectionDateYmd: string | null }[]
  }
): Promise<string | null> {
  const { data, error } = await supabase
    .from("upload_files")
    .select("upload_batch_id, original_filename, sha256, upload_batches(upload_status, is_active, sample_collection_date)")
    .eq("project_id", q.projectId)
    .eq("centre_id", q.centreId)
    .eq("file_kind", "results")
    .neq("upload_batch_id", q.uploadId)
  if (error) return `Could not check for duplicate uploads: ${error.message}`

  type Peer = { upload_status: string; is_active: boolean; sample_collection_date: string | null }
  for (const file of data ?? []) {
    const embedded = file.upload_batches as Peer | Peer[] | null
    const peer = Array.isArray(embedded) ? embedded[0] : embedded
    if (!peer || !peer.is_active || peer.upload_status === "draft" || peer.upload_status === "rejected") continue
    if (file.sha256 === q.sha256) {
      return `Duplicate entry detected: this file was already uploaded by your centre (as '${file.original_filename}').`
    }
    if (file.original_filename === q.filename && (!q.collectionDate || !peer.sample_collection_date || peer.sample_collection_date.slice(0, 10) === q.collectionDate)) {
      return `Duplicate entry detected for file '${q.filename}'.`
    }
  }

  if (q.splits?.length) {
    const { data: peers, error: peerError } = await supabase
      .from("upload_split_artifacts")
      .select("display_filename, collection_date, upload_batches(upload_status, is_active)")
      .eq("project_id", q.projectId)
      .eq("centre_id", q.centreId)
      .neq("upload_batch_id", q.uploadId)
      .in("display_filename", q.splits.map((s) => s.filename))
    if (peerError) return `Could not check for duplicate uploads: ${peerError.message}`
    type PeerBatch = { upload_status: string; is_active: boolean }
    for (const peer of peers ?? []) {
      const embedded = peer.upload_batches as PeerBatch | PeerBatch[] | null
      const batch = Array.isArray(embedded) ? embedded[0] : embedded
      if (!batch || !batch.is_active || batch.upload_status === "draft" || batch.upload_status === "rejected") continue
      const mine = q.splits.find((s) => s.filename === peer.display_filename)
      if (mine && (!mine.collectionDateYmd || !peer.collection_date || peer.collection_date.slice(0, 10) === mine.collectionDateYmd)) {
        return `Duplicate entry detected for split file '${peer.display_filename}'. This sample was already uploaded by your centre.`
      }
    }
  }
  return null
}

/** Stores the run, its issues and details, then marks the batch uploaded (awaiting approval). */
export async function recordValidation(
  service: SupabaseClient,
  r: {
    projectId: string
    centreId: string
    uploadId: string
    result: ValidationResult
    acknowledged: boolean
    split?: { mode: string; count: number }
  }
): Promise<FinalizeResult> {
  const { errors, warnings } = splitValidationIssues(r.result.issues)
  const scope = { project_id: r.projectId, centre_id: r.centreId }

  const { data: run, error: runError } = await service
    .from("validation_runs")
    .insert({
      ...scope,
      upload_batch_id: r.uploadId,
      engine_version: ENGINE_VERSION,
      passed: r.result.passed,
      error_count: errors.length,
      warning_count: warnings.length,
      detail_count: r.result.details.length,
    })
    .select("id")
    .single()
  if (runError || !run) return { ok: false, code: "DB_WRITE_FAILED", message: runError?.message ?? "Could not save validation results." }

  const rows = [
    ...r.result.issues.map((i) => ({
      ...scope,
      validation_run_id: run.id,
      severity: i.severity,
      issue_code: i.errorCode,
      message: i.errorMessage,
      well: i.well ?? null,
      target_name: i.targetName ?? null,
      record_index: i.rowNumber,
      field_name: i.fieldName,
    })),
    ...r.result.details.map((d) => ({
      ...scope,
      validation_run_id: run.id,
      severity: "detail",
      issue_code: "DETAIL",
      message: d,
    })),
  ]
  if (rows.length > 0) {
    const { error } = await service.from("validation_issues").insert(rows)
    if (error) {
      await service.from("validation_runs").delete().eq("id", run.id)
      return { ok: false, code: "DB_WRITE_FAILED", message: error.message }
    }
  }

  const { error: batchError } = await service
    .from("upload_batches")
    .update({
      upload_status: "uploaded",
      processing_status: "completed",
      submitted_at: new Date().toISOString(),
      warning_acknowledged: r.acknowledged && warnings.length > 0,
      split_mode: r.split?.mode ?? "none",
      logical_file_count: r.split?.count ?? 1,
    })
    .eq("id", r.uploadId)
  if (batchError) return { ok: false, code: "DB_WRITE_FAILED", message: batchError.message }

  return { ok: true, runId: run.id, warningCount: warnings.length }
}
