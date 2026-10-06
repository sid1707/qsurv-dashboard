/**
 * qPCR run validation, generalised from vrdl-next-platform
 * src/lib/validation/engine.ts (validateCsvContent). The structure, the order of
 * checks, the issue codes and the severities follow the AMR engine
 * (docs/validation-parity.md). What changed:
 *
 *   - Targets, aliases, fluorophores, control types and per-target Ct cut-offs
 *     come from the project's kit (kit_targets), not hardcoded tables.
 *   - Each check belongs to a rule in lib/rules/catalog.ts and runs only when
 *     the project switched it on at onboarding; thresholds come from the rule
 *     (whose defaults come from the kit's rule_defaults).
 *   - Replicate counts come from the project's plate layout instead of the
 *     fixed "3 unknown + 1 PC + 1 NTC", and a new plate_layout rule checks every
 *     well holds the tube and role the layout gives it.
 *   - The export must come from the instrument chosen for the upload.
 *   - File names follow <Centre ID>_<Name>_<Location>_<DDMMYY> (filename.ts).
 *   - Multi-sample plates are split per sample first (split/router.ts).
 */

import { countRolesByTube, samplesPerPlate, type PlateLayout, type RoleCounts } from "@/lib/plate/layout"
import { detectInstrument, INSTRUMENT_PROFILES, type InstrumentId } from "@/lib/qpcr/instruments"
import type { RuleSetting, RuleSettings } from "@/lib/rules/catalog"
import { getControlSearchColumns } from "./control-columns"
import { validateHighEndogenousCtWarning, isHighEndogenousCtWarningIssue } from "./endogenous"
import { validateUploadFilename, type CentreFileIdentity } from "./filename"
import { validateFluorophoreTargetMatching } from "./fluorophore"
import { isEndogenous, isExogenous, type ValidationKit } from "./kit"
import { matchPlate, validatePlateLayout } from "./layout-check"
import { isLowCtWarningIssue, validateLowCtWarnings } from "./low-ct"
import { parseCsvWithDynamicHeader } from "./parser"
import {
  CT_COLS,
  FLUOR_COLS,
  SAMPLE_COLS,
  TARGET_COLS,
  WELL_COLS,
  buildRows,
  formatCt,
  isBlankTarget,
  resolveColumn,
  type RunRow,
} from "./rows"
import type { ValidationIssue, ValidationResult } from "./types"

export type RunValidationInput = {
  filename: string
  csvText: string
  kit: ValidationKit
  layout: PlateLayout
  rules: RuleSettings
  instrument: InstrumentId
  /** ISO collection dates on the plate, matched against the dates in the file name. */
  sampleDates?: string[]
  /** The uploading centre, for the file name rules. Null checks only the extension. */
  centre?: CentreFileIdentity | null
  /** False for split files: the original upload's name was already checked. */
  checkFilename?: boolean
  /**
   * How many of the plate's samples this file holds: all of them for a whole
   * run, 1 for a file split from a multi-sample run. Each sample needs the
   * layout's replicates, in any of the unknown wells.
   */
  samplesInFile?: number
  now?: Date
}

function issue(partial: Omit<ValidationIssue, "severity"> & { severity?: "error" | "warning" }): ValidationIssue {
  return { ...partial, severity: partial.severity ?? "error" }
}

export function isPriorityWarningIssue(i: ValidationIssue) {
  return isLowCtWarningIssue(i) || isHighEndogenousCtWarningIssue(i)
}

/** Errors first, then the warnings people must not miss, then the rest. */
export function prioritizeValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const errors = issues.filter((i) => i.severity === "error")
  const priority = issues.filter(isPriorityWarningIssue)
  const other = issues.filter((i) => i.severity === "warning" && !isPriorityWarningIssue(i))
  return [...errors, ...priority, ...other]
}

/** `NTC (Target A)` when the row names a target, as in the AMR warning text. */
function ntcLabel(row: RunRow) {
  if (isBlankTarget(row.targetRaw)) return "NTC"
  return `NTC (${row.target?.name ?? row.targetRaw})`
}

export function validateRunExport(input: RunValidationInput): ValidationResult {
  const { kit, layout, rules } = input
  const on = (id: string): RuleSetting | null => (rules[id]?.enabled ? rules[id] : null)
  const details: string[] = []

  // ---------- Filename ----------
  const issues =
    input.checkFilename === false
      ? []
      : validateUploadFilename(input.filename, input.centre ?? null, input.sampleDates ?? [], input.now)
  if (issues.some((x) => x.severity === "error")) return { passed: false, issues, details }

  // ---------- Parse ----------
  let parsed
  try {
    parsed = parseCsvWithDynamicHeader(input.csvText)
  } catch (error) {
    return {
      passed: false,
      issues: [issue({ rowNumber: null, fieldName: "csv", errorCode: "CSV_PARSE_ERROR", errorMessage: (error as Error).message })],
      details,
    }
  }

  // ---------- Required columns (always on) ----------
  const layoutRule = on("plate_layout")
  const sampleCol = resolveColumn(parsed.headers, SAMPLE_COLS)
  const targetCol = resolveColumn(parsed.headers, TARGET_COLS)
  const ctCol = resolveColumn(parsed.headers, CT_COLS)
  const fluorCol = resolveColumn(parsed.headers, FLUOR_COLS)
  const wellCol = resolveColumn(parsed.headers, WELL_COLS)
  const required: [string, string | null][] = [
    ["Sample", sampleCol],
    ["Target", targetCol],
    ["Ct", ctCol],
    ["Fluor", fluorCol],
  ]
  if (layoutRule) required.push(["Well", wellCol])
  for (const [field, col] of required) {
    if (!col) {
      issues.push(issue({ rowNumber: null, fieldName: field, errorCode: "MISSING_REQUIRED_COLUMN", errorMessage: `Missing required column for ${field}.` }))
    }
  }
  if (!sampleCol || !targetCol || !ctCol || !fluorCol || (layoutRule && !wellCol)) {
    return { passed: false, issues, details }
  }

  // ---------- Instrument ----------
  const detected = detectInstrument(parsed.headers)
  if (detected) details.push(`Export format: ${INSTRUMENT_PROFILES[detected].label}.`)
  if (input.instrument !== "other" && detected && detected !== input.instrument) {
    issues.push(
      issue({
        rowNumber: null,
        fieldName: "csv",
        errorCode: "INSTRUMENT_MISMATCH",
        errorMessage: `This looks like a ${INSTRUMENT_PROFILES[detected].label} export, but the upload is for ${INSTRUMENT_PROFILES[input.instrument].label}. Choose the right instrument or upload that instrument's export.`,
      })
    )
  }

  // ---------- Rows, matched to a plate of the layout ----------
  const undeterminedCt = on("endogenous_ic_high_ct")?.params.undeterminedCt ?? 40
  const controlColumns = getControlSearchColumns(parsed.headers)
  const columns = { sampleCol, targetCol, ctCol, fluorCol, wellCol }
  // First pass without layout roles, only to choose the plate.
  const plate = wellCol ? matchPlate(buildRows(parsed, columns, controlColumns, kit, () => null, undeterminedCt), layout) : null
  const rows = buildRows(parsed, columns, controlColumns, kit, (well) => (well && plate?.wells[well]?.role) || null, undeterminedCt)
  details.push(`${rows.length} result rows.`)
  if (plate && layout.plates.length > 1) details.push(`Matched plate ${plate.index + 1} of ${layout.plates.length} in the plate layout.`)

  // ---------- Row checks: targets and controls ----------
  const knownTargets = on("known_targets")
  const ntcRule = on("ntc_amplification")
  const exoAmpRule = on("exogenous_ic_amplified")
  let pcRows = 0
  let ntcRows = 0
  let hasExogenous = false
  let hasExogenousAmp = false
  let hasEndogenous = false

  for (const row of rows) {
    if (knownTargets && !row.target && !isBlankTarget(row.targetRaw)) {
      issues.push(
        issue({ rowNumber: row.rowNumber, fieldName: targetCol, errorCode: "UNKNOWN_TARGET", errorMessage: `Unknown target '${row.targetRaw}'.`, well: row.well })
      )
    }
    if (row.role === "pc") pcRows++
    if (row.role === "nc") {
      ntcRows++
      if (ntcRule && row.ct !== null && row.ct <= ntcRule.params.ct) {
        issues.push(
          issue({
            rowNumber: row.rowNumber,
            fieldName: ctCol,
            errorCode: "NTC_AMPLIFIED",
            errorMessage: `${ntcLabel(row)} shows amplification Ct=${formatCt(row.ct)}.`,
            severity: "warning",
            well: row.well,
            targetName: row.target?.name,
          })
        )
      }
    }
    if (row.target && isExogenous(row.target)) {
      hasExogenous = true
      if (exoAmpRule && row.ct !== null && row.ct <= exoAmpRule.params.ct) hasExogenousAmp = true
    }
    if (row.target && isEndogenous(row.target)) hasEndogenous = true
  }

  if (on("pc_present") && pcRows === 0) {
    issues.push(issue({ rowNumber: null, fieldName: "controls", errorCode: "MISSING_PC_ROWS", errorMessage: "No positive control rows detected." }))
  }
  if (on("ntc_present") && ntcRows === 0) {
    issues.push(issue({ rowNumber: null, fieldName: "controls", errorCode: "MISSING_NTC_ROWS", errorMessage: "No NTC rows detected." }))
  }
  const exogenousName = kit.targets.find(isExogenous)?.name
  if (on("exogenous_ic_present") && !hasExogenous) {
    issues.push(
      issue({ rowNumber: null, fieldName: targetCol, errorCode: "MISSING_EXOGENOUS_CONTROL", errorMessage: `No exogenous control (${exogenousName}) rows found.` })
    )
  } else if (exoAmpRule && hasExogenous && !hasExogenousAmp) {
    issues.push(
      issue({
        rowNumber: null,
        fieldName: ctCol,
        errorCode: "EXOGENOUS_NOT_AMPLIFIED",
        errorMessage: `Exogenous control (${exogenousName}) not amplified under Ct cutoff ${formatCt(exoAmpRule.params.ct, 0)}.`,
        severity: "warning",
        targetName: exogenousName,
      })
    )
  }
  if (on("endogenous_ic_present") && !hasEndogenous) {
    const name = kit.targets.find(isEndogenous)?.name
    issues.push(
      issue({ rowNumber: null, fieldName: targetCol, errorCode: "MISSING_ENDOGENOUS_CONTROL", errorMessage: `No endogenous control (${name}) rows found.` })
    )
  }

  // ---------- Panel: every target of the tubes on this plate ----------
  const tubesOnPlate = plate ? new Set(Object.values(plate.wells).map((w) => w.tube)) : null
  const expectedTargets = kit.targets.filter((t) => !tubesOnPlate || tubesOnPlate.has(t.tube))
  if (on("panel_complete")) {
    const found = new Set(rows.map((r) => r.target?.name).filter(Boolean))
    const missing = expectedTargets.filter((t) => !found.has(t.name)).map((t) => t.name)
    if (missing.length > 0) {
      issues.push(
        issue({
          rowNumber: null,
          fieldName: "Target",
          errorCode: "MISSING_PANEL_TARGETS",
          errorMessage: `CSV must include all ${expectedTargets.length} panel targets${plate && layout.plates.length > 1 ? " on this plate" : ""}. Missing: ${missing.join(", ")}.`,
        })
      )
    }
  }

  // ---------- Plate layout ----------
  if (layoutRule && plate && wellCol) issues.push(...validatePlateLayout(rows, plate, kit, wellCol))

  // ---------- Replicates per target, as the layout sets them ----------
  if (on("replicate_configuration")) {
    const plateSamples = samplesPerPlate(layout.counts)
    const fileSamples = input.samplesInFile ?? plateSamples
    const expectedByTube: Map<string, RoleCounts> = plate
      ? countRolesByTube({ ...layout, plates: [plate.wells] })
      : new Map(kit.targets.map((t) => [t.tube, { unknown: plateSamples * layout.counts.unknownReplicates, pc: layout.counts.pc, nc: layout.counts.nc }]))
    for (const target of expectedTargets) {
      const onPlate = expectedByTube.get(target.tube)
      if (!onPlate) continue
      // The plate's unknown wells are shared by its samples; a split file holds its share.
      const expected = { ...onPlate, unknown: Math.round((onPlate.unknown * fileSamples) / plateSamples) }
      const observed: RoleCounts = { unknown: 0, pc: 0, nc: 0 }
      for (const row of rows) if (row.target === target) observed[row.role] += 1
      if (observed.unknown !== expected.unknown || observed.pc !== expected.pc || observed.nc !== expected.nc) {
        issues.push(
          issue({
            rowNumber: null,
            fieldName: "Target",
            errorCode: "MISSING_REPLICATES",
            targetName: target.name,
            errorMessage: [
              `Replicates for target ${target.name} do not match the plate layout.`,
              `Expected ${expected.unknown} unknown replicates, ${expected.pc} pos ctrl and ${expected.nc} neg ctrl.`,
              `Observed unknown replicates=${observed.unknown}, pos ctrl=${observed.pc}, neg ctrl=${observed.nc}.`,
            ].join(" "),
          })
        )
      }
    }
  }

  // ---------- Fluorophores, low Ct, endogenous control ----------
  if (on("target_fluorophore_mapping")) issues.push(...validateFluorophoreTargetMatching(rows, fluorCol))
  const lowCt = on("low_ct_warning")
  if (lowCt) issues.push(...validateLowCtWarnings(rows, ctCol, lowCt))
  const highEndo = on("endogenous_ic_high_ct")
  if (highEndo) issues.push(...validateHighEndogenousCtWarning(rows, ctCol, highEndo))

  const ordered = prioritizeValidationIssues(issues)
  return { passed: !ordered.some((i) => i.severity === "error"), issues: ordered, details }
}
