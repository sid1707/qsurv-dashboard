// Ported unchanged from vrdl-next-platform src/lib/validation/control-columns.ts.

/** Control keyword search limited to Content / Task / Sample Type (Python file_validation parity). */

export function getControlSearchColumns(headers: string[]): string[] {
  const cols: string[] = []
  for (const h of headers) {
    const norm = h.trim().toLowerCase().replace(/[\s_-]/g, "")
    if (norm === "content" || norm === "task" || norm === "sampletype") {
      cols.push(h)
    }
  }
  return cols
}

export function hasKeywordInColumns(
  row: Record<string, string>,
  keywords: string[],
  columns: string[],
): boolean {
  if (columns.length === 0) return false
  for (const col of columns) {
    const v = String(row[col] ?? "").toLowerCase()
    if (keywords.some((k) => v.includes(k))) return true
  }
  return false
}
