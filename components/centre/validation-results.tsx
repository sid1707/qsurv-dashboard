// Adapted from vrdl-next-platform app/(vrdl)/uploads/validation-results.tsx.

import { ENDOGENOUS_HIGH_CT_WARNING_DETAIL, isHighEndogenousCtWarningIssue } from "@/lib/validation/endogenous"
import { isPriorityWarningIssue } from "@/lib/validation/engine"
import { isLowCtWarningIssue } from "@/lib/validation/low-ct"
import type { ValidationIssue } from "@/lib/validation/types"

export function isRunFileIssue(issue: ValidationIssue): boolean {
  return issue.fieldName === "runFilename" || issue.errorCode.startsWith("RUNFILE")
}

function where(issue: ValidationIssue) {
  if (issue.rowNumber == null && !issue.well) return null
  const parts = [issue.rowNumber != null ? `Row ${issue.rowNumber}` : null, issue.well ? `well ${issue.well}` : null]
  return `${parts.filter(Boolean).join(", ")}: `
}

function formatIssueMessage(issue: ValidationIssue): string {
  if (issue.fieldName === "runFilename" && issue.errorCode !== "RUNFILE_CSV_NAME_MISMATCH") return `Run file: ${issue.errorMessage}`
  if (issue.fieldName === "filename") return `Results file: ${issue.errorMessage}`
  return issue.errorMessage
}

export function IssueList({ items, className }: { items: ValidationIssue[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <ul className={`list-inside list-disc space-y-2 ${className ?? ""}`}>
      {items.map((i, idx) => (
        <li key={`${i.errorCode}-${idx}`} className="whitespace-pre-wrap">
          {where(i) ? <span className="opacity-80">{where(i)}</span> : null}
          {formatIssueMessage(i)}
        </li>
      ))}
    </ul>
  )
}

export function ValidationResults({
  errors,
  warnings,
  details,
}: {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  details?: string[]
}) {
  const priority = warnings.filter(isPriorityWarningIssue)
  const lowCt = warnings.filter(isLowCtWarningIssue)
  const highEndogenous = warnings.filter(isHighEndogenousCtWarningIssue)
  const other = warnings.filter((w) => !isPriorityWarningIssue(w))
  const hasDetails = (details?.length ?? 0) > 0

  if (errors.length === 0 && warnings.length === 0 && !hasDetails) return null

  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      {errors.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <p className="font-medium text-red-800 dark:text-red-200">
            {errors.length} error{errors.length === 1 ? "" : "s"} (upload blocked)
          </p>
          <IssueList items={errors} className="mt-2 text-red-700 dark:text-red-300" />
          <p className="mt-2 text-xs text-red-700 dark:text-red-400">Fix all errors above, then submit again.</p>
        </div>
      ) : null}

      {priority.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          {lowCt.length > 0 ? (
            <>
              <p className="font-medium text-red-900 dark:text-red-200">Priority: low Ct threshold</p>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300">
                Check your run file (automatic Ct threshold or Analyze to remove noise) before confirming upload.
              </p>
              <IssueList items={lowCt} className="mt-2 text-red-800 dark:text-red-300" />
            </>
          ) : null}
          {highEndogenous.length > 0 ? (
            <div className={lowCt.length > 0 ? "mt-3 border-t border-red-200 pt-3 dark:border-red-800" : ""}>
              <p className="font-medium text-red-900 dark:text-red-200">Priority: high endogenous control Ct</p>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300">{ENDOGENOUS_HIGH_CT_WARNING_DETAIL}</p>
              <IssueList items={highEndogenous} className="mt-2 text-red-800 dark:text-red-300" />
            </div>
          ) : null}
        </div>
      ) : null}

      {other.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">Warnings</p>
          <IssueList items={other} className="mt-2 text-amber-800 dark:text-amber-300" />
        </div>
      ) : null}

      {hasDetails ? (
        <div className="rounded-md border bg-muted/50 p-3">
          <p className="font-medium">Details</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            {details!.map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
