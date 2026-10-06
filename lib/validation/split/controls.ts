// From vrdl-next-platform src/lib/split/controls.ts: control rows go into every split.

import { getControlSearchColumns, hasKeywordInColumns } from "@/lib/validation/control-columns"
import type { ParsedCsv } from "@/lib/validation/parser"
import { NTC_KEYS, PC_KEYS } from "@/lib/validation/rows"

export function findControlRowIndices(parsed: ParsedCsv): { pc: number[]; ntc: number[] } {
  const controlCols = getControlSearchColumns(parsed.headers)
  const pc: number[] = []
  const ntc: number[] = []
  parsed.rows.forEach((row, idx) => {
    if (hasKeywordInColumns(row, PC_KEYS, controlCols)) pc.push(idx)
    if (hasKeywordInColumns(row, NTC_KEYS, controlCols)) ntc.push(idx)
  })
  return { pc: [...new Set(pc)], ntc: [...new Set(ntc)] }
}

export function getControlRows(parsed: ParsedCsv): Record<string, string>[] {
  const { pc, ntc } = findControlRowIndices(parsed)
  const indices = new Set([...pc, ...ntc])
  return parsed.rows.filter((_, idx) => indices.has(idx))
}

export function getSampleRows(parsed: ParsedCsv): Record<string, string>[] {
  const { pc, ntc } = findControlRowIndices(parsed)
  const indices = new Set([...pc, ...ntc])
  return parsed.rows.filter((_, idx) => !indices.has(idx))
}
