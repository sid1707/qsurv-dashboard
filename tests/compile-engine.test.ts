import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  compileSampleCsv,
  copiesFromStdCurve,
  populationSd,
  removeOutlierReplicates,
  roundSignificant,
  type CompiledTarget,
} from "../lib/compile/engine"
import { buildCompileSetup, type CompileKitRow } from "../lib/compile/setup"
import { compileUpload, type CompileSource } from "../lib/compile/sources"
import type { RuleSettings } from "../lib/rules/catalog"

const RUNS = path.resolve(__dirname, "fixtures/runs")
const RUN = readFileSync(path.join(RUNS, "C01_HuwelLab_Pune_01102026_quantstudio5.csv"), "utf8")

const ID = { A: "00000000-0000-4000-8000-00000000000a", B: "00000000-0000-4000-8000-00000000000b", IC: "00000000-0000-4000-8000-00000000000c" }

/** The placeholder Huwel panel; the internal control's type and the curves vary per test. */
function kit(opts: { icType?: string; curves?: boolean } = {}): CompileKitRow {
  const curve = (slope: number, intercept: number) => (opts.curves ? { std_slope: slope, std_intercept: intercept } : { std_slope: null, std_intercept: null })
  const row = (id: string, target_name: string, fluorophore: string, control_type: string, sort_order: number, c: { std_slope: number | null; std_intercept: number | null }) => ({
    id,
    target_name,
    aliases: [],
    fluorophore,
    control_type,
    ct_min: null,
    ct_max: null,
    sort_order,
    tube_name: "Tube 1",
    tube_order: 1,
    ...c,
  })
  return {
    id: "k",
    name: "Huwel Multipathogen",
    version: "test",
    layout_orientation: "tubes_in_rows",
    rule_defaults: {},
    kit_targets: [
      row(ID.A, "Target A", "FAM", "none", 1, curve(-3.3, 40)),
      row(ID.B, "Target B", "HEX", "none", 2, curve(-3.4, 39)),
      row(ID.IC, "Internal Control", "Cy5", opts.icType ?? "endogenous_control", 3, { std_slope: null, std_intercept: null }),
    ],
  }
}

function setup(opts: { icType?: string; curves?: boolean; rules?: (r: RuleSettings) => void } = {}) {
  const base = buildCompileSetup(kit(opts), { plate_layout: null, compile_rules: null })
  if (opts.rules) opts.rules(base.rules)
  return base
}

const byName = (targets: CompiledTarget[]) => new Map(targets.map((t) => [t.targetName, t]))

function compiled(csv: string, s = setup()) {
  const result = compileSampleCsv(csv, s)
  if (!result.ok) throw new Error(`Expected a compiled sample, got ${result.code}: ${result.message}`)
  return result
}

describe("compileSampleCsv", () => {
  it("averages the sample replicates of each kit target, leaving the controls out", () => {
    const result = compiled(RUN)
    expect(result.sampleLabel).toBe("WW-PUNE-01")
    expect(result.targets.map((t) => t.targetName)).toEqual(["Target A", "Target B", "Internal Control"])

    const a = byName(result.targets).get("Target A")!
    // 24.512, 24.731, 24.402 → rounded to 2 dp, then the mean of the 3 sample wells (PC 21.904 left out).
    expect(a.cq).toBe(24.55)
    expect(a.cqSd).toBe(round2(populationSd([24.51, 24.73, 24.4])))
    expect(a.readings).toBe(3)
    expect(a.replicatesUsed).toBe(3)
    expect(a.kitTargetId).toBe(ID.A)
  })

  it("normalises to the kit's endogenous control: 2^(control Ct − target Ct)", () => {
    const t = byName(compiled(RUN).targets)
    expect(t.get("Internal Control")!.cq).toBe(25.28)
    expect(t.get("Internal Control")!.normalizedCq).toBe(1)
    expect(t.get("Target A")!.normalizedCq).toBe(roundSignificant(2 ** (25.28 - 24.55)))
    expect(t.get("Target A")!.normalizedCq).toBe(1.659)
  })

  it("leaves normalisation and the gate out for a kit without an endogenous control", () => {
    const s = setup({ icType: "internal_control" })
    expect(s.rules.endogenous_gate).toBeUndefined()
    expect(s.rules.endogenous_normalization).toBeUndefined()
    expect(compiled(RUN, s).targets.every((t) => t.normalizedCq === null)).toBe(true)
  })

  it("skips the sample when the endogenous control's mean Ct is above the gate's cut-off", () => {
    const result = compileSampleCsv(RUN, setup({ rules: (r) => (r.endogenous_gate.params.ct = 25) }))
    expect(result).toMatchObject({ ok: false, skip: true, code: "ENDOGENOUS_CT_HIGH" })
    expect(!result.ok && result.message).toContain("mean Internal Control Ct is 25.28 (cutoff 25)")
  })

  it("skips the sample when the endogenous control is missing", () => {
    const csv = RUN.split("\n").filter((l) => !l.includes("Internal Control")).join("\n")
    expect(compileSampleCsv(csv, setup())).toMatchObject({ ok: false, skip: true, code: "ENDOGENOUS_MISSING" })
  })

  it("does not gate when the project switched the gate off", () => {
    const result = compileSampleCsv(RUN, setup({ rules: (r) => {
      r.endogenous_gate.params.ct = 25
      r.endogenous_gate.enabled = false
    } }))
    expect(result.ok).toBe(true)
  })

  it("replaces low-Ct artefacts using the per-target cut-off, and logs them", () => {
    const a = byName(
      compiled(RUN, setup({ rules: (r) => (r.low_ct_clamp.targetOverrides = { "Target A": 24.6 }) })).targets
    ).get("Target A")!
    // 24.51 and 24.40 are below 24.6 → 40; 24.73 stays.
    expect(a.lowCtReplaced).toEqual([
      { original: 24.51, replacement: 40, cutoff: 24.6 },
      { original: 24.4, replacement: 40, cutoff: 24.6 },
    ])
    // 2 of 3 are 40 → the outlier rule keeps the undetermined pair.
    expect(a.cq).toBe(40)
    expect(a.outliersRemoved).toBe(1)
  })

  it("sets undetermined sample wells to the maximum Ct", () => {
    const csv = RUN.replace("Target B,UNKNOWN,HEX,NFQ-MGB,27.118", "Target B,UNKNOWN,HEX,NFQ-MGB,Undetermined")
    const b = byName(compiled(csv, setup({ rules: (r) => (r.outlier_removal.enabled = false) })).targets).get("Target B")!
    expect(b.readings).toBe(3)
    expect(b.cq).toBe(round2((40 + 27.31 + 26.99) / 3))
  })

  it("treats undetermined as no reading when that rule is off", () => {
    const csv = RUN.replace("Target B,UNKNOWN,HEX,NFQ-MGB,27.118", "Target B,UNKNOWN,HEX,NFQ-MGB,Undetermined")
    const b = byName(compiled(csv, setup({ rules: (r) => (r.undetermined_to_max.enabled = false) })).targets).get("Target B")!
    expect(b.readings).toBe(2)
    expect(b.cq).toBe(round2((27.31 + 26.99) / 2))
  })

  it("calculates copies from each target's standard curve when every target has one", () => {
    const s = setup({ curves: true })
    expect(s.rules.copy_number_std_curve?.enabled).toBe(true)
    const t = byName(compiled(RUN, s).targets)
    const copies = [24.51, 24.73, 24.4].map((ct) => copiesFromStdCurve(ct, -3.3, 40, 40))
    expect(t.get("Target A")!.copyNumber).toBe(round2(copies.reduce((x, y) => x + y) / 3))
    expect(t.get("Target A")!.copyNumberSd).toBe(round2(populationSd(copies)))
    // The endogenous control has no curve.
    expect(t.get("Internal Control")!.copyNumber).toBeNull()
  })

  it("has no copy numbers without standard curves", () => {
    const s = setup()
    expect(s.rules.copy_number_std_curve).toBeUndefined()
    expect(compiled(RUN, s).targets.every((t) => t.copyNumber === null)).toBe(true)
  })

  it("matches targets by alias", () => {
    const row = kit()
    row.kit_targets![0].aliases = ["TGT-A"]
    const result = compiled(RUN.replaceAll(",Target A,", ",TGT-A,"), buildCompileSetup(row, { plate_layout: null, compile_rules: null }))
    expect(result.targets[0]).toMatchObject({ targetName: "Target A", cq: 24.55 })
  })

  it("fails (rather than skips) files it cannot read", () => {
    expect(compileSampleCsv("not a run", setup())).toMatchObject({ ok: false, skip: false, code: "PARSE_ERROR" })
    const controlsOnly = RUN.split("\n").filter((l) => !l.includes("UNKNOWN")).join("\n")
    expect(compileSampleCsv(controlsOnly, setup())).toMatchObject({ ok: false, skip: false, code: "NO_SAMPLE_ROWS" })
  })
})

describe("removeOutlierReplicates", () => {
  const opts = { maxSd: 5, minReplicates: 2, undeterminedCt: 40 }

  it("drops the replicate farthest from the mean while the SD is above the limit", () => {
    expect(removeOutlierReplicates([20, 21, 38, 20.5], opts)).toEqual({ values: [20, 21, 20.5], removed: 1, reason: "SD > 5" })
  })

  it("keeps the undetermined pair when 2 of 3 replicates are undetermined", () => {
    expect(removeOutlierReplicates([40, 22, 40], opts)).toMatchObject({ values: [40, 40], removed: 1 })
  })

  it("never goes below the minimum", () => {
    expect(removeOutlierReplicates([10, 30], opts)).toEqual({ values: [10, 30], removed: 0, reason: null })
  })
})

describe("compileUpload", () => {
  const source = (name: string, csv: string, date: string): CompileSource => ({ csvText: csv, collectionDate: date, sourceFilename: name, splitKey: null })

  it("compiles each sample with its own collection date and source file", () => {
    const result = compileUpload([source("a.csv", RUN, "2026-10-01"), source("b.csv", RUN, "2026-10-08")], setup())
    expect(result).toMatchObject({ ok: true, samples: 2, skipped: 0, notes: [] })
    if (!result.ok) return
    expect(result.rows).toHaveLength(6)
    expect(result.rows[0]).toMatchObject({
      kit_target_id: ID.A,
      collection_date: "2026-10-01",
      sample_label: "WW-PUNE-01",
      target_name: "Target A",
      cq_value: 24.55,
      metric_payload: { source_file: "a.csv", control_type: "none", readings: 3, replicates_used: 3 },
    })
    expect(result.rows[3].collection_date).toBe("2026-10-08")
  })

  it("skips a sample whose endogenous control fails, with a note naming its file", () => {
    const diluted = RUN.replaceAll(/Internal Control,UNKNOWN,CY5,NFQ-MGB,[\d.]+/g, "Internal Control,UNKNOWN,CY5,NFQ-MGB,37.5")
    const result = compileUpload([source("a.csv", RUN, "2026-10-01"), source("b.csv", diluted, "2026-10-08")], setup())
    expect(result).toMatchObject({ ok: true, samples: 2, skipped: 1 })
    if (!result.ok) return
    expect(result.rows).toHaveLength(3)
    expect(result.notes[0]).toMatch(/^\[b\.csv\] Compilation skipped: mean Internal Control Ct is 37.50/)
  })

  it("stops on a file it cannot compile", () => {
    expect(compileUpload([source("a.csv", "garbage", "2026-10-01")], setup())).toMatchObject({ ok: false })
  })
})

function round2(v: number) {
  return Math.round(v * 100) / 100
}
