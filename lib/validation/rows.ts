import { PLATE_ROWS, type WellRole } from "@/lib/plate/layout"
import { hasKeywordInColumns } from "./control-columns"
import type { KitTargetSpec, ValidationKit } from "./kit"

/** Column names recognised in instrument exports (vrdl-next-platform engine.ts, plus wells). */
export const SAMPLE_COLS = ["Sample", "Sample Name", "Sample Type", "Content"]
export const TARGET_COLS = ["Target", "Target Name", "Gene Name"]
export const CT_COLS = ["Ct", "Cq", "Cт Mean", "Cт", "CT"]
export const FLUOR_COLS = ["Fluor", "Reporter", "Fluorophore", "Dye"]
// QuantStudio has both a numeric "Well" and "Well Position" (A1); prefer the position.
export const WELL_COLS = ["Well Position", "Well", "Position", "Pos"]

// Control keywords, searched only in Content / Task / Sample Type (legacy parity).
export const NTC_KEYS = ["neg ctrl", "ntc", "no template", "nc", "negative control", "blank", "water", "h2o"]
export const PC_KEYS = ["pc", "positive control", "standard", "std", "reference", "pos ctrl"]

export function resolveColumn(headers: string[], options: string[]): string | null {
  for (const o of options) if (headers.includes(o)) return o
  for (const o of options) {
    const match = headers.find((h) => h.toLowerCase() === o.toLowerCase())
    if (match) return match
  }
  return null
}

/** Undetermined counts as `undeterminedCt`; blank, NaN and N/A mean no reading. */
export function toCt(value: unknown, undeterminedCt = 40): number | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim().toLowerCase()
  if (!s || ["nan", "none", "na", "n/a"].includes(s)) return null
  if (s === "ud" || s.includes("undetermined")) return undeterminedCt
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A1, A01 (Bio-Rad) or 1–96 (QuantStudio numeric wells, row by row) to A1. */
export function normaliseWell(value: unknown): string | null {
  const s = String(value ?? "").trim().toUpperCase()
  const named = s.match(/^([A-H])0?([1-9]|1[0-2])$/)
  if (named) return `${named[1]}${named[2]}`
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s)
    if (n >= 1 && n <= 96) return `${PLATE_ROWS[Math.floor((n - 1) / 12)]}${((n - 1) % 12) + 1}`
  }
  return null
}

export const formatCt = (value: number, places = 2) => (Math.round(value * 10 ** places) / 10 ** places).toFixed(places)

export const ROLE_NAMES: Record<WellRole, string> = {
  unknown: "a sample",
  pc: "a positive control",
  nc: "a negative control",
}

/** One result row of the export, with everything the checks need. */
export type RunRow = {
  rowNumber: number
  raw: Record<string, string>
  targetRaw: string
  target: KitTargetSpec | undefined
  ct: number | null
  fluorRaw: string
  well: string | null
  /** The role the file gives the row (Task/Content), or null when it has no such column. */
  fileRole: WellRole | null
  /** The role used by the checks: the file's, else the plate layout's, else sample. */
  role: WellRole
}

export type RunColumns = { sampleCol: string; targetCol: string; ctCol: string; fluorCol: string; wellCol: string | null }

export function fileRoleOf(row: Record<string, string>, controlColumns: string[]): WellRole | null {
  if (controlColumns.length === 0) return null
  if (hasKeywordInColumns(row, NTC_KEYS, controlColumns)) return "nc"
  if (hasKeywordInColumns(row, PC_KEYS, controlColumns)) return "pc"
  return "unknown"
}

const BLANK_TARGETS = new Set(["", "nan", "none", "na", "n/a"])
export const isBlankTarget = (raw: string) => BLANK_TARGETS.has(raw.trim().toLowerCase())

export function buildRows(
  parsed: { headerRowIndex: number; rows: Record<string, string>[] },
  columns: RunColumns,
  controlColumns: string[],
  kit: ValidationKit,
  layoutRole: (well: string | null) => WellRole | null,
  undeterminedCt: number
): RunRow[] {
  return parsed.rows.map((raw, idx) => {
    const well = columns.wellCol ? normaliseWell(raw[columns.wellCol]) : null
    const fileRole = fileRoleOf(raw, controlColumns)
    return {
      rowNumber: parsed.headerRowIndex + idx + 2,
      raw,
      targetRaw: String(raw[columns.targetCol] ?? "").trim(),
      target: kit.resolve(raw[columns.targetCol]),
      ct: toCt(raw[columns.ctCol], undeterminedCt),
      fluorRaw: String(raw[columns.fluorCol] ?? "").trim(),
      well,
      fileRole,
      role: fileRole ?? layoutRole(well) ?? "unknown",
    }
  })
}
