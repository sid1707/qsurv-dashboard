// From vrdl-next-platform src/lib/validation/high-ent-ct.ts. "ENT" becomes
// whichever target the kit marks as its endogenous control (e.g. Enterobacter
// spp. or PMMoV); the cut-off and undetermined Ct come from the project's rule.

import type { RuleSetting } from "@/lib/rules/catalog"
import { isEndogenous } from "./kit"
import { formatCt, type RunRow } from "./rows"
import type { ValidationIssue } from "./types"

export const HIGH_ENDOGENOUS_CT_WARNING_CODE = "ENDOGENOUS_CT_HIGH"

export const ENDOGENOUS_HIGH_CT_WARNING_DETAIL =
  "If you upload this file, it can be approved but will not be used for compilation."

export function isHighEndogenousCtWarningIssue(issue: ValidationIssue): boolean {
  return issue.severity === "warning" && issue.errorCode === HIGH_ENDOGENOUS_CT_WARNING_CODE
}

/** Blank, NaN and undetermined endogenous readings count as the undetermined Ct. */
export function meanUnknownSampleEndogenousCt(rows: RunRow[], undeterminedCt: number): number | null {
  const values = rows
    .filter((r) => r.role === "unknown" && r.target && isEndogenous(r.target))
    .map((r) => r.ct ?? undeterminedCt)
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function validateHighEndogenousCtWarning(rows: RunRow[], ctCol: string, rule: RuleSetting): ValidationIssue[] {
  const undetermined = rule.params.undeterminedCt ?? 40
  const cutoff = rule.params.ct
  const mean = meanUnknownSampleEndogenousCt(rows, undetermined)
  if (mean === null || mean <= cutoff) return []

  const control = rows.find((r) => r.target && isEndogenous(r.target))?.target?.name ?? "endogenous control"
  return [
    {
      rowNumber: null,
      fieldName: ctCol,
      errorCode: HIGH_ENDOGENOUS_CT_WARNING_CODE,
      severity: "warning",
      targetName: control,
      errorMessage: [
        `Mean ${control} Ct is ${formatCt(mean)} (cutoff ${formatCt(cutoff, 0)}), indicating that the sample is diluted.`,
        ENDOGENOUS_HIGH_CT_WARNING_DETAIL,
        `Undetermined/NaN ${control} values are counted as ${undetermined}.`,
      ].join(" "),
    },
  ]
}
