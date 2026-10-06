import type { PlateLayout, PlateWells } from "@/lib/plate/layout"
import type { ValidationKit } from "./kit"
import { ROLE_NAMES, type RunRow } from "./rows"
import type { ValidationIssue } from "./types"

/**
 * Plate layout check (new in QSurv). The project's layout says which tube and
 * role every well holds. One export is one plate, so the file is matched to the
 * layout plate it fits best, then each well is checked against it.
 */

export type MatchedPlate = { index: number; wells: PlateWells }

/** The plate whose wells agree with the most rows (target in the well's tube). */
export function matchPlate(rows: RunRow[], layout: PlateLayout): MatchedPlate | null {
  if (layout.plates.length === 0) return null
  let best: MatchedPlate = { index: 0, wells: layout.plates[0] }
  let bestScore = -1
  layout.plates.forEach((wells, index) => {
    const score = rows.filter((r) => r.well && r.target && wells[r.well]?.tube === r.target.tube).length
    if (score > bestScore) {
      best = { index, wells }
      bestScore = score
    }
  })
  return best
}

/** Past this many wells, the remaining layout problems are summarised in one line. */
const MAX_LAYOUT_ISSUES = 12

function tubeSummary(kit: ValidationKit, tube: string) {
  const names = kit.targets.filter((t) => t.tube === tube).map((t) => t.name)
  return names.length > 0 ? `${tube} (${names.join(", ")})` : tube
}

export function validatePlateLayout(rows: RunRow[], plate: MatchedPlate, kit: ValidationKit, wellCol: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  const add = (key: string, issue: Omit<ValidationIssue, "severity" | "fieldName">) => {
    if (seen.has(key)) return
    seen.add(key)
    issues.push({ ...issue, fieldName: wellCol, severity: "error" })
  }

  for (const row of rows) {
    if (!row.well || !row.target) continue
    const expected = plate.wells[row.well]
    if (!expected) {
      add(`${row.well}:empty`, {
        rowNumber: row.rowNumber,
        errorCode: "WELL_NOT_IN_LAYOUT",
        errorMessage: `Well ${row.well} has results for ${row.target.name} but is empty in the plate layout.`,
        well: row.well,
        targetName: row.target.name,
      })
      continue
    }
    if (expected.tube !== row.target.tube) {
      add(`${row.well}:tube`, {
        rowNumber: row.rowNumber,
        errorCode: "WRONG_WELL_TARGET",
        errorMessage: `Well ${row.well} should hold ${tubeSummary(kit, expected.tube)} but reports ${row.target.name}.`,
        well: row.well,
        targetName: row.target.name,
      })
    }
    if (row.fileRole && row.fileRole !== expected.role) {
      add(`${row.well}:role`, {
        rowNumber: row.rowNumber,
        errorCode: "WRONG_WELL_ROLE",
        errorMessage: `Well ${row.well} is ${ROLE_NAMES[expected.role]} in the plate layout but the file marks it as ${ROLE_NAMES[row.fileRole]}.`,
        well: row.well,
        targetName: row.target.name,
      })
    }
  }

  if (issues.length <= MAX_LAYOUT_ISSUES) return issues
  const shown = issues.slice(0, MAX_LAYOUT_ISSUES - 1)
  const rest = new Set(issues.slice(MAX_LAYOUT_ISSUES - 1).map((i) => i.well)).size
  shown.push({
    rowNumber: null,
    fieldName: wellCol,
    errorCode: "PLATE_LAYOUT_MISMATCH",
    errorMessage: `${rest} more well${rest === 1 ? "" : "s"} do not match the plate layout. Check that the plate was loaded with the project's layout.`,
    severity: "error",
  })
  return shown
}
