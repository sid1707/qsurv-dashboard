// From vrdl-next-platform src/lib/split/split-by-dates.ts. The output name is
// the original's centre prefix plus the sample's date, e.g. C01_AIIMS_Delhi_011026.csv.

import { parseCsvWithDynamicHeader } from "@/lib/validation/parser"
import { getControlRows, getSampleRows } from "./controls"
import { ddmmyyToYmd, extractDateFromIdentifier } from "./date-utils"
import { buildSplitCsvText } from "./serialize"
import type { SplitArtifact } from "./types"

const IDENTIFIER_COLUMN_KEYS = ["biological set name", "biogroup name", "biogroup", "sample", "sample name"] as const

export function resolveIdentifierColumns(headers: string[]): string[] {
  const lower = new Map(headers.map((h) => [h.toLowerCase(), h]))
  const columns: string[] = []
  const seen = new Set<string>()
  for (const key of IDENTIFIER_COLUMN_KEYS) {
    let col: string | undefined
    if (key === "sample" && headers.includes("Sample")) col = "Sample"
    else if (lower.has(key)) col = lower.get(key)!
    if (col && !seen.has(col)) {
      columns.push(col)
      seen.add(col)
    }
  }
  return columns
}

function extractDateFromIdentifierColumns(row: Record<string, string>, identifierColumns: string[]): string | null {
  for (const col of identifierColumns) {
    const date = extractDateFromIdentifier(row[col])
    if (date) return date
  }
  return null
}

/** `outputBase` is the centre prefix from the uploaded file name, e.g. "C01_AIIMS_Delhi". */
export function splitByCollectionDates(csvText: string, outputBase: string): SplitArtifact[] {
  const parsed = parseCsvWithDynamicHeader(csvText)
  const identifierColumns = resolveIdentifierColumns(parsed.headers)
  if (identifierColumns.length === 0) {
    throw new Error(
      "Error: None of the required columns ('Sample Name', 'Sample' or 'Biological Set Name') found in the file. Put each sample's collection date in one of them."
    )
  }

  const sampleRows = getSampleRows(parsed)
  const controlRows = getControlRows(parsed)
  const rowsWithDate = sampleRows.map((row) => ({ row, dateToken: extractDateFromIdentifierColumns(row, identifierColumns) }))

  const uniqueDates = [...new Set(rowsWithDate.map((r) => r.dateToken).filter((d): d is string => Boolean(d)))]
  if (uniqueDates.length === 0) {
    const colsLabel = identifierColumns.map((c) => `'${c}'`).join(", ")
    throw new Error(
      `Error: No valid date identifiers found in the data. Expected either a plain date (DDMMYY or DDMMYYYY) or a {Text}_{date} pattern in one of: ${colsLabel}.`
    )
  }
  const undated = rowsWithDate.filter((r) => !r.dateToken).length
  if (undated > 0) {
    throw new Error(`Error: ${undated} sample row(s) have no date in their identifier, so they cannot be assigned to a sample.`)
  }

  return uniqueDates.sort().map((dateToken, splitIndex) => {
    const dateRows = rowsWithDate.filter((r) => r.dateToken === dateToken).map((r) => r.row)
    return {
      filename: `${outputBase}_${dateToken}.csv`,
      csvText: buildSplitCsvText(csvText, parsed, [...dateRows, ...controlRows]),
      splitKey: dateToken,
      splitGroup: dateToken,
      collectionDateYmd: ddmmyyToYmd(dateToken),
      splitMode: "by_date",
      splitIndex,
    }
  })
}
