import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { UploadBatchStatus } from "@/lib/upload/status"

type Embedded<T> = T | T[] | null
const many = <T>(v: Embedded<T>): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

type FileRow = { id: string; file_kind: string; original_filename: string; storage_path: string; size_bytes: number | null }
type RunRow = { id: string; passed: boolean; error_count: number; warning_count: number; created_at: string }

export type UploadListItem = UploadBatchStatus & {
  id: string
  created_at: string
  submitted_at: string | null
  sample_collection_date: string | null
  instrument: string | null
  rejection_reason: string | null
  resultsFilename: string | null
  latestRun: RunRow | null
}

const latest = (runs: RunRow[]) => [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null

/** The centre's uploads, newest first. RLS limits centre users to their own centre. */
export async function listCentreUploads(supabase: SupabaseClient, projectId: string, centreId: string): Promise<UploadListItem[]> {
  const { data, error } = await supabase
    .from("upload_batches")
    .select(
      "id, created_at, submitted_at, sample_collection_date, instrument, upload_status, processing_status, approval_status, rejection_reason, upload_files(file_kind, original_filename), validation_runs(id, passed, error_count, warning_count, created_at)"
    )
    .eq("project_id", projectId)
    .eq("centre_id", centreId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw new Error(`Could not load uploads: ${error.message}`)

  return (data ?? []).map((b) => ({
    id: b.id,
    created_at: b.created_at,
    submitted_at: b.submitted_at,
    sample_collection_date: b.sample_collection_date,
    instrument: b.instrument,
    upload_status: b.upload_status,
    processing_status: b.processing_status,
    approval_status: b.approval_status,
    rejection_reason: b.rejection_reason,
    resultsFilename: many(b.upload_files as Embedded<FileRow>).find((f) => f.file_kind === "results")?.original_filename ?? null,
    latestRun: latest(many(b.validation_runs as Embedded<RunRow>)),
  }))
}

export type UploadIssue = {
  id: number
  severity: "error" | "warning" | "detail"
  issue_code: string
  message: string
  well: string | null
  target_name: string | null
  record_index: number | null
  field_name: string | null
}

type SplitRow = { id: string; split_index: number; display_filename: string; collection_date: string | null; split_key: string }

export type UploadDetail = Omit<UploadListItem, "resultsFilename" | "latestRun"> & {
  sample_collection_dates: string[] | null
  split_mode: string
  splits: SplitRow[]
  notes: string | null
  compile_notes: string | null
  warning_acknowledged: boolean
  approved_at: string | null
  files: FileRow[]
  latestRun: RunRow | null
  issues: UploadIssue[]
}

const SEVERITY_RANK = { error: 0, warning: 1, detail: 2 } as const

export async function getUploadDetail(
  supabase: SupabaseClient,
  projectId: string,
  centreId: string,
  uploadId: string
): Promise<UploadDetail | null> {
  if (!z.uuid().safeParse(uploadId).success) return null
  const { data, error } = await supabase
    .from("upload_batches")
    .select(
      "id, created_at, submitted_at, sample_collection_date, sample_collection_dates, split_mode, instrument, upload_status, processing_status, approval_status, rejection_reason, compile_notes, notes, warning_acknowledged, approved_at, upload_files(id, file_kind, original_filename, storage_path, size_bytes), validation_runs(id, passed, error_count, warning_count, created_at), upload_split_artifacts(id, split_index, display_filename, collection_date, split_key)"
    )
    .eq("id", uploadId)
    .eq("project_id", projectId)
    .eq("centre_id", centreId)
    .maybeSingle()
  if (error) throw new Error(`Could not load the upload: ${error.message}`)
  if (!data) return null

  const run = latest(many(data.validation_runs as Embedded<RunRow>))
  let issues: UploadIssue[] = []
  if (run) {
    const result = await supabase
      .from("validation_issues")
      .select("id, severity, issue_code, message, well, target_name, record_index, field_name")
      .eq("validation_run_id", run.id)
      .order("id")
    if (result.error) throw new Error(`Could not load validation issues: ${result.error.message}`)
    issues = ((result.data ?? []) as UploadIssue[]).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id - b.id)
  }

  const { upload_files, validation_runs: _runs, upload_split_artifacts, ...batch } = data
  void _runs
  const splits = many(upload_split_artifacts as Embedded<SplitRow>).sort((a, b) => a.split_index - b.split_index)
  return { ...batch, files: many(upload_files as Embedded<FileRow>), splits, latestRun: run, issues } as UploadDetail
}

export type CentreIssueRow = UploadIssue & {
  created_at: string
  upload_batch_id: string
  resultsFilename: string | null
  sample_collection_date: string | null
}

/**
 * Warnings and errors from the centre's validation runs, newest first (the AMR
 * validation summary). Submitted runs only carry warnings, since errors block.
 */
export async function listCentreValidationIssues(supabase: SupabaseClient, projectId: string, centreId: string): Promise<CentreIssueRow[]> {
  const { data, error } = await supabase
    .from("validation_issues")
    .select(
      "id, severity, issue_code, message, well, target_name, record_index, field_name, created_at, validation_runs(upload_batch_id, upload_batches(sample_collection_date, upload_files(file_kind, original_filename)))"
    )
    .eq("project_id", projectId)
    .eq("centre_id", centreId)
    .neq("severity", "detail")
    .order("created_at", { ascending: false })
    .limit(300)
  if (error) throw new Error(`Could not load validation results: ${error.message}`)

  type Batch = { sample_collection_date: string | null; upload_files: Embedded<FileRow> }
  type Run = { upload_batch_id: string; upload_batches: Embedded<Batch> }
  return (data ?? []).map((row) => {
    const run = many(row.validation_runs as Embedded<Run>)[0]
    const batch = run ? many(run.upload_batches)[0] : undefined
    return {
      id: row.id,
      severity: row.severity,
      issue_code: row.issue_code,
      message: row.message,
      well: row.well,
      target_name: row.target_name,
      record_index: row.record_index,
      field_name: row.field_name,
      created_at: row.created_at,
      upload_batch_id: run?.upload_batch_id ?? "",
      sample_collection_date: batch?.sample_collection_date ?? null,
      resultsFilename: many(batch?.upload_files ?? null).find((f) => f.file_kind === "results")?.original_filename ?? null,
    }
  })
}
