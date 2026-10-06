// Ported unchanged from vrdl-next-platform src/lib/csv/parser.ts.

export type ParsedCsv = {
  headerRowIndex: number
  headers: string[]
  rows: Record<string, string>[]
}

const TARGET_HEADER_KEYWORDS = ["target", "gene name", "gene_name"]
const HEADER_HINTS = ["sample", "well", "target", "ct", "cq", "reporter", "fluor"]

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === "," && !inQuotes) {
      out.push(current.trim())
      current = ""
      continue
    }
    current += ch
  }
  out.push(current.trim())
  return out
}

export function findDynamicHeaderRow(csvText: string): number {
  const lines = csvText.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue
    const lower = line.toLowerCase()
    const hasTargetKeyword = TARGET_HEADER_KEYWORDS.some((k) => lower.includes(k))
    const hasHints = HEADER_HINTS.some((k) => lower.includes(k))
    const commaCount = (line.match(/,/g) ?? []).length
    if (hasTargetKeyword && hasHints && commaCount >= 4) return i
  }
  return -1
}

export function parseCsvWithDynamicHeader(csvText: string): ParsedCsv {
  const headerRowIndex = findDynamicHeaderRow(csvText)
  if (headerRowIndex < 0) {
    throw new Error("Could not find a header row with 'Target', 'Target Name', or 'Gene name'")
  }
  const lines = csvText.split(/\r?\n/).slice(headerRowIndex).filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw new Error("CSV contains header row but no data rows")
  const headers = splitCsvLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? ""
    })
    return row
  })
  return { headerRowIndex, headers, rows }
}
