// From vrdl-next-platform src/lib/validation/low-ct.ts. Cut-offs come from the
// project's low_ct_warning rule: its per-target overrides (from the kit insert),
// then kit_targets.ct_min, then the rule's default Ct.

import type { RuleSetting } from "@/lib/rules/catalog"
import { isInternalControl, type KitTargetSpec } from "./kit"
import { formatCt, type RunRow } from "./rows"
import type { ValidationIssue } from "./types"

export const LOW_CT_WARNING_CODE = "LOW_CT_THRESHOLD"

export function lowCtCutoff(target: KitTargetSpec, rule: RuleSetting): number {
  return rule.targetOverrides?.[target.name] ?? target.ctMin ?? rule.params.ct
}

export function isLowCtWarningIssue(issue: ValidationIssue): boolean {
  return issue.severity === "warning" && issue.errorCode === LOW_CT_WARNING_CODE
}

export function validateLowCtWarnings(rows: RunRow[], ctCol: string, rule: RuleSetting): ValidationIssue[] {
  const offenders = rows.flatMap((row) => {
    if (row.role !== "unknown" || !row.target || isInternalControl(row.target) || row.ct === null) return []
    const cutoff = lowCtCutoff(row.target, rule)
    return row.ct < cutoff ? [{ row, cutoff }] : []
  })
  if (offenders.length === 0) return []

  const lines = offenders
    .map(
      ({ row, cutoff }) =>
        `Row ${row.rowNumber}${row.well ? ` (${row.well})` : ""}: ${row.target!.name} Ct=${formatCt(row.ct!)} (cutoff ${formatCt(cutoff, 0)})`
    )
    .join("\n")

  return [
    {
      rowNumber: null,
      fieldName: ctCol,
      errorCode: LOW_CT_WARNING_CODE,
      severity: "warning",
      errorMessage: [
        "Suspiciously low Ct values detected in unknown sample replicates.",
        "Check your run file: set automatic Ct threshold or click Analyze to remove noise, then re-export the CSV.",
        "",
        "Affected replicates:",
        lines,
      ].join("\n"),
    },
  ]
}
