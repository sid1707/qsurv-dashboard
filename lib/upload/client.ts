// Browser side of the upload pipeline, from vrdl-next-platform lib/upload/client.ts:
// validate → (confirm warnings) → start batch → signed upload of each file → submit.

import { createClient } from "@/lib/supabase/client"
import type { UploadApiErrorBody } from "@/lib/upload/api"
import type {
  PipelineFailure,
  UploadFormMetadata,
  UploadPipelineResult,
  UploadPipelineStage,
  ValidateOnlyResult,
  ValidationIssue,
} from "@/lib/upload/client-types"
import type { UploadFileKind } from "@/lib/upload/path"

const STATUS_FALLBACKS: Record<number, { message: string; code: string }> = {
  401: { message: "You are not signed in. Sign in again and retry.", code: "AUTH_REQUIRED" },
  403: { message: "You do not have permission to perform this action.", code: "AUTH_FORBIDDEN" },
  404: { message: "The requested upload resource was not found.", code: "NOT_FOUND" },
  409: { message: "Confirmation is required before proceeding.", code: "CONFLICT" },
  500: { message: "A server error occurred. Try again later.", code: "SERVER_ERROR" },
}

export async function parseUploadApiError(response: Response): Promise<UploadApiErrorBody> {
  let body: Partial<UploadApiErrorBody> = {}
  try {
    body = (await response.json()) as Partial<UploadApiErrorBody>
  } catch {
    /* not JSON */
  }
  const fallback = STATUS_FALLBACKS[response.status]
  return {
    message: body.message ?? fallback?.message ?? `Request failed (${response.status})`,
    code: body.code ?? fallback?.code ?? "REQUEST_FAILED",
    stage: body.stage,
    issues: body.issues,
    details: body.details,
  }
}

function failureFromApi(stage: UploadPipelineStage, err: UploadApiErrorBody): PipelineFailure {
  return { stage, message: err.message, code: err.code, issues: err.issues, details: err.details }
}

export function mapStorageUploadError(fileKind: UploadFileKind, rawMessage: string): PipelineFailure {
  const label = fileKind === "results" ? "results export" : "run file"
  const lower = rawMessage.toLowerCase()
  const forbidden = lower.includes("forbidden") || lower.includes("row-level security") || lower.includes("policy")
  return {
    stage: fileKind === "results" ? "uploading_results" : "uploading_runfile",
    code: forbidden ? "STORAGE_FORBIDDEN" : "STORAGE_UPLOAD_FAILED",
    message: forbidden
      ? `Could not upload the ${label}: storage access was denied. Check you are signed in to the right project, then retry.`
      : `Could not upload the ${label}: ${rawMessage}`,
  }
}

export function buildValidateFormData(results: File, runFilename: string, metadata: UploadFormMetadata): FormData {
  const fd = new FormData()
  fd.append("projectCode", metadata.projectCode)
  fd.append("results", results)
  fd.append("runFilename", runFilename)
  fd.append("instrument", metadata.instrument)
  for (const date of metadata.sampleCollectionDates) fd.append("sampleCollectionDates", date)
  return fd
}

type ValidateResponse = UploadApiErrorBody & {
  passed?: boolean
  hasBlockingErrors?: boolean
  hasWarnings?: boolean
  issues?: ValidationIssue[]
  details?: string[]
}

export async function validateResultsOnly(formData: FormData, onStage?: (s: UploadPipelineStage) => void): Promise<ValidateOnlyResult> {
  onStage?.("validating")
  const res = await fetch("/api/uploads/validate", { method: "POST", body: formData })
  if (!res.ok) return { ok: false, failure: failureFromApi("validating", await parseUploadApiError(res)) }

  const json = (await res.json()) as ValidateResponse
  if (!json.passed || json.hasBlockingErrors) {
    return {
      ok: false,
      failure: {
        stage: "validating",
        code: "VALIDATION_FAILED",
        message: "Validation failed. Fix the errors below before uploading.",
        issues: json.issues ?? [],
        details: json.details,
      },
    }
  }
  return { ok: true, hasWarnings: Boolean(json.hasWarnings), issues: json.issues ?? [], details: json.details ?? [] }
}

type FileRef = { bucket: string; storagePath: string; originalFilename: string; sizeBytes: number; mimeType?: string }

async function signedUpload(
  projectCode: string,
  uploadId: string,
  fileKind: UploadFileKind,
  file: File
): Promise<{ ok: true; ref: FileRef } | { ok: false; failure: PipelineFailure }> {
  const stage = fileKind === "results" ? "uploading_results" : "uploading_runfile"
  const signed = await fetch("/api/uploads/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectCode, uploadId, filename: file.name, fileKind }),
  })
  if (!signed.ok) return { ok: false, failure: failureFromApi(stage, await parseUploadApiError(signed)) }

  const payload = (await signed.json()) as { bucket: string; path: string; token: string; storagePath: string }
  const { error } = await createClient().storage.from(payload.bucket).uploadToSignedUrl(payload.path, payload.token, file)
  if (error) return { ok: false, failure: mapStorageUploadError(fileKind, error.message) }

  return {
    ok: true,
    ref: {
      bucket: payload.bucket,
      storagePath: payload.storagePath,
      originalFilename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || undefined,
    },
  }
}

export async function runUploadPipeline(opts: {
  resultsFile: File
  runFile: File
  metadata: UploadFormMetadata
  warningAcknowledged: boolean
  onStage?: (stage: UploadPipelineStage) => void
}): Promise<UploadPipelineResult> {
  const { resultsFile, runFile, metadata, warningAcknowledged, onStage } = opts

  onStage?.("starting_batch")
  const start = await fetch("/api/uploads/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  })
  if (!start.ok) return { ok: false, failure: failureFromApi("starting_batch", await parseUploadApiError(start)) }
  const { uploadId } = (await start.json()) as { uploadId: string }

  onStage?.("uploading_results")
  const results = await signedUpload(metadata.projectCode, uploadId, "results", resultsFile)
  if (!results.ok) return { ok: false, failure: results.failure }

  onStage?.("uploading_runfile")
  const run = await signedUpload(metadata.projectCode, uploadId, "runfile", runFile)
  if (!run.ok) return { ok: false, failure: run.failure }

  onStage?.("submitting")
  const submit = await fetch("/api/uploads/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectCode: metadata.projectCode, uploadId, warningAcknowledged, results: results.ref, runfile: run.ref }),
  })
  if (submit.status === 409) {
    const err = await parseUploadApiError(submit)
    // 409 is also "already submitted"; only warnings need the confirmation dialog.
    return { ok: false, needsWarningAck: err.code === "WARNINGS_REQUIRE_ACK", failure: failureFromApi("submitting", err) }
  }
  if (!submit.ok) return { ok: false, failure: failureFromApi("submitting", await parseUploadApiError(submit)) }

  onStage?.("done")
  return { ok: true, uploadId }
}
