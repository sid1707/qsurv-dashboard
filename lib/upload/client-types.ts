// From vrdl-next-platform lib/upload/client-types.ts.

import type { ValidationIssue } from "@/lib/validation/types"
import type { InstrumentId } from "@/lib/qpcr/instruments"

export type { ValidationIssue }

export const NOTES_MAX_LENGTH = 1000

export type UploadPipelineStage = "validating" | "starting_batch" | "uploading_results" | "uploading_runfile" | "submitting" | "done"

export type PipelineFailure = {
  stage: UploadPipelineStage
  message: string
  code?: string
  issues?: ValidationIssue[]
  details?: string[]
}

export type UploadFormMetadata = {
  projectCode: string
  instrument: InstrumentId
  /** ISO dates: one per sample on multi-date plates, otherwise one. */
  sampleCollectionDates: string[]
  notes: string | null
}

export type ValidateOnlyResult =
  | { ok: true; hasWarnings: boolean; issues: ValidationIssue[]; details: string[] }
  | { ok: false; failure: PipelineFailure }

export type UploadPipelineResult =
  | { ok: true; uploadId: string }
  | { ok: false; failure: PipelineFailure; needsWarningAck?: boolean }
