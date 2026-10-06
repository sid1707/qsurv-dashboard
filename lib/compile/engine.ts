/**
 * qPCR compilation, generalised from vrdl-next-platform lib/compile
 * (qpcr-processor.ts, normalize-ent.ts, targets-config.ts). The order of steps
 * and the arithmetic follow the AMR processor. What changed:
 *
 *   - Targets, aliases and standard curves come from the project's kit
 *     (kit_targets), not TARGET_ALIASES / ARG_TARGETS.
 *   - Each step belongs to a compile rule in lib/rules/catalog.ts and runs only
 *     when the project switched it on; cut-offs come from the rule (whose
 *     defaults come from the kit's rule_defaults).
 *   - "ENT" is whichever target the kit marks as its endogenous control.
 *   - Sample and control wells get the roles they had in validation: the file's
 *     Task/Content column, else the project's plate layout.
 *   - Normalised values keep 4 significant figures instead of 2 decimals, so
 *     low relative abundances (1e-4 and below) do not round to 0.
 *   - The normalisation method is the project's choice: 2^ΔCt (the AMR
 *     processor), an efficiency-corrected ratio from the kit's standard
 *     curves, or plain ΔCt. All are stored in normalized_cq.
 */

import { isEndogenous, type KitTargetSpec } from "@/lib/validation/kit"
import { matchPlate } from "@/lib/validation/layout-check"
import { parseCsvWithDynamicHeader, type ParsedCsv } from "@/lib/validation/parser"
import { getControlSearchColumns } from "@/lib/validation/control-columns"
import { CT_COLS, FLUOR_COLS, SAMPLE_COLS, TARGET_COLS, WELL_COLS, buildRows, formatCt, resolveColumn } from "@/lib/validation/rows"
import { NORMALIZATION_METHODS, normalizationMethodOf, type NormalizationMethod, type RuleSetting } from "@/lib/rules/catalog"
import type { CompileSetup } from "./setup"

export type LowCtReplacement = { original: number; replacement: number; cutoff: number }

export type CompiledTarget = {
  targetName: string
  kitTargetId: string | null
  controlType: string
  /** Mean Ct of the kept replicates; null when no replicate had a reading. */
  cq: number | null
  cqSd: number | null
  /** Null when the copy-number rule is off or the target has no standard curve. */
  copyNumber: number | null
  copyNumberSd: number | null
  /** Relative to the endogenous control by the project's method; null when the normalisation rule is off. */
  normalizedCq: number | null
  normalizationMethod: NormalizationMethod | null
  readings: number
  replicatesUsed: number
  lowCtReplaced: LowCtReplacement[]
  outliersRemoved: number
  outlierReason: string | null
}

/** Failures that skip the sample (the upload can still be approved) versus ones that block approval. */
export type CompileSkipCode = "ENDOGENOUS_MISSING" | "ENDOGENOUS_CT_HIGH"
export type CompileErrorCode = "PARSE_ERROR" | "MISSING_COLUMNS" | "NO_SAMPLE_ROWS" | "NO_PANEL_TARGETS"

export type CompileSampleResult =
  | { ok: true; sampleLabel: string | null; targets: CompiledTarget[] }
  | { ok: false; skip: true; code: CompileSkipCode; message: string }
  | { ok: false; skip: false; code: CompileErrorCode; message: string }

const DEFAULT_UNDETERMINED_CT = 40

export const round2 = (v: number) => Math.round(v * 100) / 100

/** Four significant figures; 0 stays 0. */
export function roundSignificant(v: number, digits = 4): number {
  if (v === 0 || !Number.isFinite(v)) return v
  return Number(v.toPrecision(digits))
}

const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length

/** Population SD, as the AMR processor (numpy default). */
export function populationSd(vals: number[]): number {
  if (vals.length <= 1) return 0
  const m = mean(vals)
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length)
}

/**
 * From removeOutlierReplicates: with 3 replicates and 2+ undetermined, keep the
 * undetermined ones; otherwise, while the SD is above the limit, drop the value
 * farthest from the mean, keeping at least `minReplicates`.
 */
export function removeOutlierReplicates(
  values: number[],
  opts: { maxSd: number; minReplicates: number; undeterminedCt: number }
): { values: number[]; removed: number; reason: string | null } {
  if (values.length <= opts.minReplicates) return { values, removed: 0, reason: null }

  if (values.length === 3) {
    const undetermined = values.filter((v) => v >= opts.undeterminedCt)
    if (undetermined.length >= 2) {
      return {
        values: undetermined,
        removed: values.length - undetermined.length,
        reason: `2 of 3 values are ${opts.undeterminedCt} (undetermined)`,
      }
    }
  }

  const kept = [...values]
  while (kept.length > opts.minReplicates && populationSd(kept) > opts.maxSd) {
    const m = mean(kept)
    let farthest = 0
    kept.forEach((v, i) => {
      if (Math.abs(v - m) > Math.abs(kept[farthest] - m)) farthest = i
    })
    kept.splice(farthest, 1)
  }
  const removed = values.length - kept.length
  return { values: kept, removed, reason: removed > 0 ? `SD > ${opts.maxSd}` : null }
}

/** Amplification factor per cycle from a standard curve slope: 2 at 100% efficiency (slope ≈ −3.32). */
export const amplificationFactor = (slope: number) => 10 ** (-1 / slope)

/**
 * The value stored in normalized_cq for one target, given the control's and
 * the target's mean Ct. Undetermined handling follows the AMR processor: an
 * undetermined control gives 0 for the ratio methods (no ΔCt can be taken).
 */
export function normalizeToControl(
  method: NormalizationMethod,
  r: { cq: number; controlCq: number | null; undeterminedCt: number; targetE?: number | null; controlE?: number | null }
): number | null {
  const controlFailed = r.controlCq === null || r.controlCq >= r.undeterminedCt
  switch (method) {
    case NORMALIZATION_METHODS.deltaCt:
      return controlFailed ? null : round2(r.cq - r.controlCq!)
    case NORMALIZATION_METHODS.efficiencyCorrected: {
      if (controlFailed) return 0
      if (!r.targetE || !r.controlE) return null
      // E_c^Ct_c / E_t^Ct_t, in logs so large Ct values do not overflow.
      return roundSignificant(Math.exp(r.controlCq! * Math.log(r.controlE) - r.cq * Math.log(r.targetE)))
    }
    default:
      return controlFailed ? 0 : roundSignificant(2 ** (r.controlCq! - r.cq))
  }
}

/** Copies from a standard curve: Ct = slope · log10(copies) + intercept. Undetermined gives 0. */
export function copiesFromStdCurve(ct: number, slope: number, intercept: number, undeterminedCt: number): number {
  if (!Number.isFinite(ct) || ct >= undeterminedCt) return 0
  return Math.max(0, 10 ** ((ct - intercept) / slope))
}

function sampleLabelOf(rows: { raw: Record<string, string> }[], sampleCol: string | null): string | null {
  if (!sampleCol) return null
  const names = [...new Set(rows.map((r) => String(r.raw[sampleCol] ?? "").trim()).filter(Boolean))]
  return names.length > 0 ? names.join(", ") : null
}

/** Compiles one sample's run export (a whole run, or one file split from a multi-sample run). */
export function compileSampleCsv(csvText: string, setup: CompileSetup): CompileSampleResult {
  const { kit, layout, rules } = setup
  const on = (id: string): RuleSetting | null => (rules[id]?.enabled ? rules[id] : null)

  let parsed: ParsedCsv
  try {
    parsed = parseCsvWithDynamicHeader(csvText)
  } catch (error) {
    return { ok: false, skip: false, code: "PARSE_ERROR", message: (error as Error).message }
  }

  const sampleCol = resolveColumn(parsed.headers, SAMPLE_COLS)
  const targetCol = resolveColumn(parsed.headers, TARGET_COLS)
  const ctCol = resolveColumn(parsed.headers, CT_COLS)
  const fluorCol = resolveColumn(parsed.headers, FLUOR_COLS)
  const wellCol = resolveColumn(parsed.headers, WELL_COLS)
  if (!targetCol || !ctCol) {
    return { ok: false, skip: false, code: "MISSING_COLUMNS", message: `Missing ${!targetCol ? "target" : "Cq/Ct"} column in the results file.` }
  }

  const maxRule = on("undetermined_to_max")
  const undeterminedCt = maxRule?.params.ct ?? DEFAULT_UNDETERMINED_CT
  // With the rule off, "Undetermined" is not a number: NaN marks it as no reading.
  const readUndetermined = maxRule ? maxRule.params.ct : Number.NaN
  const columns = { sampleCol: sampleCol ?? "", targetCol, ctCol, fluorCol: fluorCol ?? "", wellCol }
  const controlColumns = getControlSearchColumns(parsed.headers)
  const plate = wellCol ? matchPlate(buildRows(parsed, columns, controlColumns, kit, () => null, readUndetermined), layout) : null
  const rows = buildRows(parsed, columns, controlColumns, kit, (well) => (well && plate?.wells[well]?.role) || null, readUndetermined)

  // unknown_only_filter (always on): controls never reach the compiled data.
  const sampleRows = rows.filter((r) => r.role === "unknown")
  if (sampleRows.length === 0) {
    return { ok: false, skip: false, code: "NO_SAMPLE_ROWS", message: "No sample (unknown) rows found after leaving out the controls." }
  }

  const lowCtRule = on("low_ct_clamp")
  const outlierRule = on("outlier_removal")
  const curveRule = on("copy_number_std_curve")

  const readings = new Map<KitTargetSpec, number[]>()
  const lowCtLogs = new Map<KitTargetSpec, LowCtReplacement[]>()
  for (const row of sampleRows) {
    if (!row.target) continue
    let ct = row.ct
    if (ct === null && maxRule) ct = maxRule.params.ct
    if (ct === null || Number.isNaN(ct)) continue
    ct = round2(ct)
    if (maxRule && ct > maxRule.params.ct) ct = maxRule.params.ct

    if (lowCtRule) {
      const cutoff = lowCtRule.targetOverrides?.[row.target.name] ?? lowCtRule.params.ct
      if (ct < cutoff) {
        const replacement = lowCtRule.params.replacementCt
        lowCtLogs.set(row.target, [...(lowCtLogs.get(row.target) ?? []), { original: ct, replacement, cutoff }])
        ct = replacement
      }
    }
    readings.set(row.target, [...(readings.get(row.target) ?? []), ct])
  }

  const seen = kit.targets.filter((t) => sampleRows.some((r) => r.target === t))
  if (seen.length === 0) {
    return { ok: false, skip: false, code: "NO_PANEL_TARGETS", message: "None of the kit's targets were found in the sample rows." }
  }

  const compiled: CompiledTarget[] = seen.map((target) => {
    const all = readings.get(target) ?? []
    const kept = outlierRule
      ? removeOutlierReplicates(all, { maxSd: outlierRule.params.maxSd, minReplicates: outlierRule.params.minReplicates, undeterminedCt })
      : { values: all, removed: 0, reason: null }
    const values = kept.values

    let cq: number | null = values.length > 0 ? mean(values) : null
    if (cq !== null && maxRule) cq = Math.min(cq, maxRule.params.ct)

    const meta = setup.targets.get(target.name)
    let copyNumber: number | null = null
    let copyNumberSd: number | null = null
    if (curveRule && meta?.stdSlope != null && meta.stdIntercept != null && values.length > 0) {
      const copies = values.map((v) => copiesFromStdCurve(v, meta.stdSlope!, meta.stdIntercept!, undeterminedCt))
      copyNumber = round2(mean(copies))
      copyNumberSd = round2(populationSd(copies))
    }

    return {
      targetName: target.name,
      kitTargetId: meta?.id ?? null,
      controlType: target.controlType,
      cq: cq === null ? null : round2(cq),
      cqSd: values.length > 0 ? round2(populationSd(values)) : null,
      copyNumber,
      copyNumberSd,
      normalizedCq: null,
      normalizationMethod: null,
      readings: all.length,
      replicatesUsed: values.length,
      lowCtReplaced: lowCtLogs.get(target) ?? [],
      outliersRemoved: kept.removed,
      outlierReason: kept.reason,
    }
  })

  // ---------- Endogenous control: gate, then normalise ----------
  const endogenous = kit.targets.find(isEndogenous)
  const endoRow = endogenous ? compiled.find((c) => c.targetName === endogenous.name) : undefined
  const gate = on("endogenous_gate")
  if (gate && endogenous) {
    if (!endoRow || endoRow.cq === null) {
      return {
        ok: false,
        skip: true,
        code: "ENDOGENOUS_MISSING",
        message: `Compilation skipped: no ${endogenous.name} (endogenous control) readings in the sample wells.`,
      }
    }
    if (endoRow.cq > gate.params.ct) {
      return {
        ok: false,
        skip: true,
        code: "ENDOGENOUS_CT_HIGH",
        message: `Compilation skipped: mean ${endogenous.name} Ct is ${formatCt(endoRow.cq)} (cutoff ${formatCt(gate.params.ct, 0)}), indicating that the sample is diluted.`,
      }
    }
  }

  const normalization = on("endogenous_normalization")
  if (normalization && endogenous) {
    const method = normalizationMethodOf(normalization)
    const controlCq = endoRow?.cq ?? null
    const factor = (name: string) => {
      const slope = setup.targets.get(name)?.stdSlope
      return slope != null && slope < 0 ? amplificationFactor(slope) : null
    }
    const controlE = factor(endogenous.name)
    for (const row of compiled) {
      row.normalizationMethod = method
      if (row === endoRow) {
        // The control against itself: ratio 1 (0 when undetermined), ΔCt 0.
        const determined = row.cq !== null && row.cq < undeterminedCt
        row.normalizedCq = method === NORMALIZATION_METHODS.deltaCt ? (determined ? 0 : null) : determined ? 1 : 0
      } else if (row.cq === null) {
        row.normalizedCq = null
      } else {
        row.normalizedCq = normalizeToControl(method, { cq: row.cq, controlCq, undeterminedCt, targetE: factor(row.targetName), controlE })
      }
    }
  }

  return { ok: true, sampleLabel: sampleLabelOf(sampleRows, sampleCol), targets: compiled }
}
