// From vrdl-next-platform src/lib/split/types.ts. The AMR plate compositions
// become the project's plate layout (samples per plate and multi-sample mode).

import type { ValidationIssue } from "@/lib/validation/types"

export type SplitMode = "none" | "by_date" | "by_identifier"

export type SplitArtifact = {
  filename: string
  csvText: string
  splitKey: string
  splitGroup: string
  collectionDateYmd: string | null
  splitMode: SplitMode
  splitIndex: number
}

export type AggregatedSplitValidation = {
  passed: boolean
  issues: ValidationIssue[]
  details: string[]
  splitFiles: string[]
  splitCount: number
  logicalFileCount: number
}

export function splitIssue(partial: Omit<ValidationIssue, "severity"> & { severity?: "error" | "warning" }): ValidationIssue {
  return { severity: partial.severity ?? "error", ...partial }
}
