// Ported from vrdl-next-platform src/lib/split/serialize.ts.

import type { ParsedCsv } from "@/lib/validation/parser"

function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function serializeParsedCsv(parsed: ParsedCsv, rows: Record<string, string>[]): string {
  const headerLine = parsed.headers.map(escapeCell).join(",")
  const dataLines = rows.map((row) => parsed.headers.map((h) => escapeCell(row[h] ?? "")).join(","))
  return [headerLine, ...dataLines].join("\n")
}

/** Preserve leading noise lines before the dynamic header when present. */
export function prefixLinesBeforeHeader(csvText: string, headerRowIndex: number): string {
  const lines = csvText.split(/\r?\n/)
  if (headerRowIndex <= 0) return ""
  return lines.slice(0, headerRowIndex).join("\n")
}

export function buildSplitCsvText(originalCsvText: string, parsed: ParsedCsv, rows: Record<string, string>[]): string {
  const prefix = prefixLinesBeforeHeader(originalCsvText, parsed.headerRowIndex)
  const body = serializeParsedCsv(parsed, rows)
  return prefix ? `${prefix}\n${body}` : body
}
