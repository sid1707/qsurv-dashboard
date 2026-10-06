import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { loadCompileSetup } from "./setup"
import { compileUpload, loadCompileSources, type CompileBatch } from "./sources"

/**
 * Approve and compile, from vrdl-next-platform lib/compile/approve-and-compile.ts.
 * Runs on the project admin's own session (RLS lets them read the stored
 * files and write compiled rows). When the project has data compilation on,
 * the stored run is compiled first; the rows, the approval and the audit event
 * are then written together by public.approve_upload.
 */

export type ApproveProject = {
  id: string
  kit_id: string
  data_compilation: boolean
  plate_layout: unknown
  compile_rules: unknown
}

export type ReviewCode = "NOT_FOUND" | "NOT_READY" | "COMPILE_FAILED" | "DB_ERROR"

export type ApproveResult =
  | {
      ok: true
      rowsWritten: number
      alreadyApproved: boolean
      /** Compilation is on but no sample could be compiled (endogenous control failed). */
      compileSkipped: boolean
      compileNotes: string | null
    }
  | { ok: false; code: ReviewCode; message: string }

export const REVIEW_HTTP_STATUS: Record<ReviewCode, number> = {
  NOT_FOUND: 404,
  NOT_READY: 409,
  COMPILE_FAILED: 422,
  DB_ERROR: 500,
}

const BATCH_SELECT =
  "id, approval_status, upload_status, processing_status, is_active, sample_collection_date, split_mode, upload_files(file_kind, original_filename, storage_bucket, storage_path), upload_split_artifacts(split_index, display_filename, collection_date, split_key, storage_bucket, storage_path)"

type Batch = CompileBatch & { id: string; approval_status: string; upload_status: string; processing_status: string | null; is_active: boolean }

/** Database errors from the review functions: P0001/P0002/22023 carry a message meant for the admin. */
function rpcFailure(error: { code?: string; message: string }): { ok: false; code: ReviewCode; message: string } {
  if (error.code === "P0002") return { ok: false, code: "NOT_FOUND", message: error.message }
  if (error.code === "P0001" || error.code === "22023") return { ok: false, code: "NOT_READY", message: error.message }
  return { ok: false, code: "DB_ERROR", message: `Could not save the review: ${error.message}` }
}

export function readyForApproval(b: Pick<Batch, "approval_status" | "upload_status" | "processing_status" | "is_active">) {
  return b.is_active && b.approval_status === "pending" && b.upload_status === "uploaded" && b.processing_status === "completed"
}

export async function approveUpload(supabase: SupabaseClient, project: ApproveProject, uploadId: string): Promise<ApproveResult> {
  if (!z.uuid().safeParse(uploadId).success) return { ok: false, code: "NOT_FOUND", message: "Upload not found." }

  const { data, error } = await supabase
    .from("upload_batches")
    .select(BATCH_SELECT)
    .eq("id", uploadId)
    .eq("project_id", project.id)
    .maybeSingle()
  if (error) return { ok: false, code: "DB_ERROR", message: `Could not load the upload: ${error.message}` }
  const batch = data as Batch | null
  if (!batch) return { ok: false, code: "NOT_FOUND", message: "Upload not found." }

  if (batch.approval_status === "approved") {
    return { ok: true, rowsWritten: 0, alreadyApproved: true, compileSkipped: false, compileNotes: null }
  }
  if (batch.approval_status === "rejected") {
    return { ok: false, code: "NOT_READY", message: "This upload was rejected and cannot be approved." }
  }
  if (!readyForApproval(batch)) return { ok: false, code: "NOT_READY", message: "This upload is not ready for approval." }

  let rows: unknown[] = []
  let notes: string[] = []
  let compileSkipped = false
  if (project.data_compilation) {
    let setup
    try {
      setup = await loadCompileSetup(supabase, project)
    } catch (e) {
      return { ok: false, code: "DB_ERROR", message: (e as Error).message }
    }
    const loaded = await loadCompileSources(supabase, {
      ...batch,
      upload_files: batch.upload_files ?? [],
      upload_split_artifacts: batch.upload_split_artifacts ?? [],
    })
    if (!loaded.ok) return { ok: false, code: "COMPILE_FAILED", message: loaded.message }
    const compiled = compileUpload(loaded.sources, setup)
    if (!compiled.ok) return { ok: false, code: "COMPILE_FAILED", message: compiled.message }
    rows = compiled.rows
    notes = compiled.notes
    compileSkipped = compiled.skipped === compiled.samples
    if (compileSkipped) notes.push("The upload was approved, but no data was compiled.")
  }

  const compileNotes = notes.length > 0 ? notes.join("\n") : null
  const { data: saved, error: rpcError } = await supabase.rpc("approve_upload", {
    p_upload_id: uploadId,
    p_measurements: rows,
    p_compile_notes: compileNotes,
  })
  if (rpcError) return rpcFailure(rpcError)

  const result = (saved ?? {}) as { already_approved?: boolean; rows_written?: number }
  return {
    ok: true,
    rowsWritten: Number(result.rows_written ?? 0),
    alreadyApproved: Boolean(result.already_approved),
    compileSkipped,
    compileNotes,
  }
}

export async function rejectUpload(
  supabase: SupabaseClient,
  projectId: string,
  uploadId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; code: ReviewCode; message: string }> {
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, code: "NOT_READY", message: "Rejection reason is required." }
  if (trimmed.length > 1000) return { ok: false, code: "NOT_READY", message: "Keep the reason under 1000 characters." }
  if (!z.uuid().safeParse(uploadId).success) return { ok: false, code: "NOT_FOUND", message: "Upload not found." }

  // Scope the upload to this project before the database checks the reviewer.
  const { data, error } = await supabase.from("upload_batches").select("id").eq("id", uploadId).eq("project_id", projectId).maybeSingle()
  if (error) return { ok: false, code: "DB_ERROR", message: `Could not load the upload: ${error.message}` }
  if (!data) return { ok: false, code: "NOT_FOUND", message: "Upload not found." }

  const { error: rpcError } = await supabase.rpc("reject_upload", { p_upload_id: uploadId, p_reason: trimmed })
  return rpcError ? rpcFailure(rpcError) : { ok: true }
}
