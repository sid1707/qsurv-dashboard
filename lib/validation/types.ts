// From vrdl-next-platform src/lib/validation/types.ts, with the well and kit
// target recorded on each issue (validation_issues.well / target_name).

export type ValidationSeverity = "error" | "warning"

export type ValidationIssue = {
  rowNumber: number | null
  fieldName: string
  errorCode: string
  errorMessage: string
  severity: ValidationSeverity
  well?: string | null
  targetName?: string | null
}

export type ValidationResult = {
  passed: boolean
  issues: ValidationIssue[]
  details: string[]
}

/** Bumped when the checks change, so stored runs say which engine produced them. */
export const ENGINE_VERSION = "qsurv-validation-1"
