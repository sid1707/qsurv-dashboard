import { SAMPLE_IDENTIFIER_COLUMNS } from "@/lib/plate/layout"
import { parseCsvWithDynamicHeader, type ParsedCsv } from "@/lib/validation/parser"
import { WELL_COLS, normaliseWell, resolveColumn } from "@/lib/validation/rows"
import type { ValidationIssue } from "@/lib/validation/types"
import { findControlRowIndices } from "./controls"
import { extractDateFromIdentifier } from "./date-utils"
import { resolveIdentifierColumns } from "./split-by-dates"
import { planIdentifierSplit } from "./split-by-identifier"
import { splitIssue } from "./types"

/**
 * New in QSurv: before a multi-sample run is split, check that every sample row
 * carries an identifier and that they name as many samples as the plate holds.
 * The AMR split silently drops rows it cannot place; here they block the upload
 * with a message that says which wells and which columns to fix.
 */

const COLUMNS = SAMPLE_IDENTIFIER_COLUMNS.join(", ").replace(/, ([^,]*)$/, " or $1")
const display = (ddmmyy: string) => `${ddmmyy.slice(0, 2)}/${ddmmyy.slice(2, 4)}/20${ddmmyy.slice(4, 6)}`

function wellList(parsed: ParsedCsv, rows: Record<string, string>[]) {
  const wellCol = resolveColumn(parsed.headers, WELL_COLS)
  const wells = [...new Set(rows.map((r) => (wellCol ? normaliseWell(r[wellCol]) : null)).filter(Boolean))] as string[]
  if (wells.length === 0) return ""
  const shown = wells.slice(0, 8).join(", ")
  return ` (well${wells.length === 1 ? "" : "s"} ${shown}${wells.length > 8 ? ` and ${wells.length - 8} more` : ""})`
}

export function checkSampleIdentifiers(
  csvText: string,
  strategy: "by_date" | "by_identifier",
  samples: number
): ValidationIssue[] {
  let parsed: ParsedCsv
  try {
    parsed = parseCsvWithDynamicHeader(csvText)
  } catch {
    return [] // The engine reports files it cannot read.
  }
  const what = strategy === "by_date" ? "collection date" : "site identifier"
  const plateText = `This project runs ${samples} samples per plate (${strategy === "by_date" ? "multiple dates" : "multiple sites"})`
  const fail = (errorCode: string, errorMessage: string) => [splitIssue({ rowNumber: null, fieldName: "csv", errorCode, errorMessage })]

  const columns = resolveIdentifierColumns(parsed.headers)
  if (columns.length === 0) {
    return fail(
      "MISSING_SPLIT_IDENTIFIER_COLUMN",
      `${plateText}, so the export needs each sample's ${what} in a ${COLUMNS} column. None of these columns is in the file.`
    )
  }

  const { pc, ntc } = findControlRowIndices(parsed)
  const controls = new Set([...pc, ...ntc])
  const sampleRows = parsed.rows.filter((_, i) => !controls.has(i))

  // The identifier each sample row is split by, or null when it has none.
  let keyOf: (row: Record<string, string>) => string | null
  if (strategy === "by_date") {
    keyOf = (row) => {
      for (const col of columns) {
        const date = extractDateFromIdentifier(row[col])
        if (date) return date
      }
      return null
    }
  } else {
    let plan: ReturnType<typeof planIdentifierSplit>
    try {
      plan = planIdentifierSplit(csvText, { multiIdentifierPlate: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("Some sample rows contain ETP/STP")) {
        return fail(
          "SPLIT_IDENTIFIER_INCONSISTENT",
          `Some sample rows name a site (ETP/STP) and others do not. Give every sample row its site identifier in ${COLUMNS}.`
        )
      }
      return fail(
        "MISSING_SPLIT_IDENTIFIERS",
        `${plateText}, but no sample row has a ${what} in ${COLUMNS}. Give each sample's wells the same site label (e.g. ETP, STP).`
      )
    }
    // The plan parses its own copy of the rows, so match them by content (each row has its well).
    const groupOf = new Map<string, string>()
    for (const value of plan.uniqueValues) {
      for (const row of plan.getRowsForValue(value, parsed)) groupOf.set(JSON.stringify(row), value)
    }
    keyOf = (row) => groupOf.get(JSON.stringify(row)) ?? null
  }

  const unplaced = sampleRows.filter((row) => !keyOf(row))
  if (sampleRows.length > 0 && unplaced.length === sampleRows.length) {
    return fail(
      strategy === "by_date" ? "NO_IDENTIFIER_DATES" : "MISSING_SPLIT_IDENTIFIERS",
      strategy === "by_date"
        ? `${plateText}, but no sample row has a collection date in ${COLUMNS}. Put each sample's date there as DDMMYY or DDMMYYYY (e.g. 01102026, or WW_01102026).`
        : `${plateText}, but no sample row has a ${what} in ${COLUMNS}. Give each sample's wells the same site label (e.g. ETP, STP).`
    )
  }
  if (unplaced.length > 0) {
    return fail(
      "SPLIT_IDENTIFIER_MISSING",
      `${unplaced.length} sample row(s)${wellList(parsed, unplaced)} have no ${what} in ${COLUMNS}, so they cannot be assigned to a sample.`
    )
  }

  const groups = [...new Set(sampleRows.map(keyOf))] as string[]
  if (groups.length !== samples) {
    const named = strategy === "by_date" ? groups.sort().map(display) : groups.sort()
    return fail(
      "SPLIT_GROUP_COUNT_MISMATCH",
      `${plateText}, but the ${what}s in ${COLUMNS} name ${groups.length}: ${named.join(", ")}. Each sample needs its own ${what}.`
    )
  }
  return []
}
