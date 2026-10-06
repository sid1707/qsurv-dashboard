// Ported from vrdl-next-platform src/lib/split/split-by-identifier.ts. "Multiple sites"
// plates take the place of the AMR multi ETP/STP plate compositions.

import { parseCsvWithDynamicHeader } from "@/lib/validation/parser"
import { getControlRows, getSampleRows } from "./controls"
import { buildSplitCsvText } from "./serialize"
import type { SplitArtifact } from "./types"

export type IdentifierSplitOptions = {
  multiIdentifierPlate?: boolean
}

const ETP_STP_MARKER_RE = /\bETP(?:[-_\s]?\d+)?\b|\bSTP(?:[-_\s]?\d+)?\b/i

function extractEtpStpLabel(cell: string | null | undefined): string | null {
  if (cell == null || String(cell).trim() === "") return null
  const m = ETP_STP_MARKER_RE.exec(String(cell).trim())
  if (!m) return null
  return m[0].toUpperCase().replace(/\s+/g, "")
}

function resolveColumns(headers: string[]): {
  bioColumn: string | null
  sampleColumn: string | null
} {
  const lower = new Map(headers.map((h) => [h.toLowerCase(), h]))
  return {
    bioColumn: lower.get("biological set name") ?? null,
    sampleColumn: lower.get("sample") ?? lower.get("sample name") ?? null,
  }
}

export type IdentifierSplitPlan = {
  uniqueValues: string[]
  keyColumn: string
  mode: "column_exact" | "sample_derived"
  getRowsForValue: (value: string, parsed: ReturnType<typeof parseCsvWithDynamicHeader>) => Record<string, string>[]
}

export function planIdentifierSplit(csvText: string, options?: IdentifierSplitOptions): IdentifierSplitPlan {
  const parsed = parseCsvWithDynamicHeader(csvText)
  const { bioColumn, sampleColumn } = resolveColumns(parsed.headers)
  if (!bioColumn && !sampleColumn) {
    throw new Error("Error: None of the required columns ('Sample Name', 'Sample' or 'Biological Set Name') found in the file. Put each sample's site label in one of them.")
  }

  const sampleRows = getSampleRows(parsed)
  const controlRows = getControlRows(parsed)
  const controlSet = new Set(controlRows)

  const combine = (matched: Record<string, string>[]) => [
    ...matched.filter((r) => !controlSet.has(r)),
    ...controlRows,
  ]

  if (bioColumn) {
    const uniqueBio = [...new Set(sampleRows.map((r) => String(r[bioColumn] ?? "").trim()).filter(Boolean))]
    const splitByBioColumn =
      uniqueBio.length > 0 &&
      (options?.multiIdentifierPlate
        ? uniqueBio.length >= 2
        : uniqueBio.some((v) => ETP_STP_MARKER_RE.test(v)))

    if (splitByBioColumn) {
      const uniqueValues = [...uniqueBio].sort()
      return {
        uniqueValues,
        keyColumn: bioColumn,
        mode: "column_exact",
        getRowsForValue: (value) =>
          combine(parsed.rows.filter((r) => String(r[bioColumn] ?? "").trim() === value)),
      }
    }
  }

  if (!sampleColumn) {
    throw new Error("Error: No ETP/STP differentiator found in biological set and no sample column.")
  }

  const sampleOnlyDerived = sampleRows.map((r) => extractEtpStpLabel(r[sampleColumn]))
  const hasAny = sampleOnlyDerived.some((d) => d != null)
  const hasNone = sampleOnlyDerived.some((d) => d == null)
  if (hasAny && hasNone) {
    throw new Error("Error: Some sample rows contain ETP/STP markers while others do not.")
  }

  if (hasAny) {
    const uniqueValues = [...new Set(sampleOnlyDerived.filter((d): d is string => Boolean(d)))].sort()
    return {
      uniqueValues,
      keyColumn: sampleColumn,
      mode: "sample_derived",
      getRowsForValue: (value) =>
        combine(parsed.rows.filter((r) => extractEtpStpLabel(r[sampleColumn]) === value)),
    }
  }

  if (!options?.multiIdentifierPlate) {
    return {
      uniqueValues: ["original"],
      keyColumn: sampleColumn,
      mode: "column_exact",
      getRowsForValue: () => combine(sampleRows),
    }
  }

  const uniqueSamp = [...new Set(sampleRows.map((r) => String(r[sampleColumn] ?? "").trim()).filter(Boolean))]
  if (uniqueSamp.length === 0) {
    throw new Error("Error: No non-empty Sample values found for split.")
  }
  const uniqueValues = [...uniqueSamp].sort()
  return {
    uniqueValues,
    keyColumn: sampleColumn,
    mode: "column_exact",
    getRowsForValue: (value) =>
      combine(parsed.rows.filter((r) => String(r[sampleColumn] ?? "").trim() === value)),
  }
}

export function buildOutputFilename(originalFilename: string, identifierValue: string): string {
  let stem = originalFilename.replace(/\.csv$/i, "")
  if (stem.includes(" - ")) stem = stem.split(" - ")[0].trim()
  const nameParts = stem.split("_")
  if (nameParts.length >= 2) {
    const outParts = [...nameParts]
    outParts[1] = `${nameParts[1]}-${identifierValue}`
    return `${outParts.join("_")}.csv`
  }
  return `${stem}-${identifierValue}.csv`
}

export function splitByIdentifier(
  csvText: string,
  filename: string,
  collectionDateYmd: string | null,
  multiIdentifierPlate = false,
): SplitArtifact[] {
  const parsed = parseCsvWithDynamicHeader(csvText)
  const plan = planIdentifierSplit(csvText, {
    multiIdentifierPlate,
  })

  return plan.uniqueValues.map((value, splitIndex) => {
    const rows = plan.getRowsForValue(value, parsed)
    const outFilename = buildOutputFilename(filename, value)
    const csvOut = buildSplitCsvText(csvText, parsed, rows)
    return {
      filename: outFilename,
      csvText: csvOut,
      splitKey: value,
      splitGroup: value,
      collectionDateYmd,
      splitMode: "by_identifier" as const,
      splitIndex,
    }
  })
}

export function discoverIdentifierGroupCount(csvText: string, multiIdentifierPlate = false): number {
  return planIdentifierSplit(csvText, {
    multiIdentifierPlate,
  }).uniqueValues.length
}
