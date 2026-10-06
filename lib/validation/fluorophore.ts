// From vrdl-next-platform src/lib/validation/fluorophore.ts. The expected dye
// per target now comes from kit_targets.fluorophore instead of ARG_TARGETS.

import { normFluor } from "./kit"
import type { RunRow } from "./rows"
import type { ValidationIssue } from "./types"

export function validateFluorophoreTargetMatching(rows: RunRow[], fluorCol: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const row of rows) {
    if (!row.target) continue
    const fluor = normFluor(row.fluorRaw)
    // A blank dye cell is not checked (legacy parity).
    if (fluor === "" || row.target.fluorophores.has(fluor)) continue
    issues.push({
      rowNumber: row.rowNumber,
      fieldName: fluorCol,
      errorCode: "FLUOROPHORE_TARGET_MISMATCH",
      errorMessage: `Target '${row.targetRaw}' has fluorophore '${row.fluorRaw}' but expected ${row.target.fluorophoreLabel}.`,
      severity: "error",
      well: row.well,
      targetName: row.target.name,
    })
  }
  return issues
}
