import { describe, expect, it } from "vitest"
import type { KitPanel } from "../lib/kits/public"
import {
  RULES,
  RULES_BY_ID,
  availableOptions,
  availableRules,
  defaultRuleSettings,
  normalizationMethodOf,
  parseRuleSettings,
} from "../lib/rules/catalog"
import { KIT } from "./onboarding-fixtures"

const noControlsKit: KitPanel = {
  orientation: "tubes_in_rows",
  ruleDefaults: {},
  tubes: [{ name: "T1", order: 1, targets: [{ name: "A", fluorophore: "FAM", controlType: "none", hasStdCurve: false }] }],
}

describe("rules catalogue", () => {
  it("has unique ids and sensible parameter defaults", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length)
    for (const rule of RULES) {
      for (const p of rule.params) expect(p.default >= p.min && p.default <= p.max, `${rule.id}.${p.key}`).toBe(true)
    }
  })

  it("hides rules the kit cannot support", () => {
    const qc = availableRules(noControlsKit, "qc").map((r) => r.id)
    expect(qc).not.toContain("exogenous_ic_present")
    expect(qc).not.toContain("endogenous_ic_high_ct")
    const compile = availableRules(noControlsKit, "compile").map((r) => r.id)
    expect(compile).not.toContain("endogenous_normalization")
    expect(compile).not.toContain("copy_number_std_curve")

    expect(availableRules(KIT, "qc").map((r) => r.id)).toContain("exogenous_ic_amplified")
    // Every measured target in the test kit has a standard curve.
    expect(availableRules(KIT, "compile").map((r) => r.id)).toContain("copy_number_std_curve")
  })

  it("defaults to every available rule on, with kit values overriding catalogue defaults", () => {
    const qc = defaultRuleSettings(KIT, "qc")
    expect(Object.values(qc).every((r) => r.enabled)).toBe(true)
    expect(qc.ntc_amplification.params).toEqual({ ct: 37 })
    expect(qc.exogenous_ic_amplified.params).toEqual({ ct: 35 })
    const compile = defaultRuleSettings(KIT, "compile")
    expect(compile.low_ct_clamp).toEqual({ enabled: true, params: { ct: 14, replacementCt: 40 }, targetOverrides: { MTB: 20 } })
    expect(compile.outlier_removal.params).toEqual({ maxSd: 5, minReplicates: 2 })
  })

  it("keeps locked rules on, drops unknown rules and takes overrides from the kit", () => {
    const result = parseRuleSettings(
      {
        required_columns: { enabled: false, params: {} },
        made_up_rule: { enabled: true, params: {} },
        ntc_amplification: { enabled: false, params: { ct: 36 } },
      },
      KIT,
      "qc",
      "qcRules"
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.required_columns.enabled).toBe(true)
    expect(result.data).not.toHaveProperty("made_up_rule")
    expect(result.data.ntc_amplification).toEqual({ enabled: false, params: { ct: 36 } })
    // Rules missing from the input fall back to the kit default.
    expect(result.data.pc_present.enabled).toBe(true)

    const compile = parseRuleSettings(
      { low_ct_clamp: { enabled: true, params: { ct: 12, replacementCt: 40 }, targetOverrides: { MTB: 1 } } },
      KIT,
      "compile",
      "compileRules"
    )
    expect(compile.ok && compile.data.low_ct_clamp.targetOverrides).toEqual({ MTB: 20 })
  })

  it("reports out-of-range parameters only for enabled rules", () => {
    const bad = parseRuleSettings({ outlier_removal: { enabled: true, params: { maxSd: 99, minReplicates: 2 } } }, KIT, "compile", "compileRules")
    expect(bad).toMatchObject({ ok: false, errors: { "compileRules.outlier_removal.maxSd": expect.any(String) } })

    const off = parseRuleSettings({ outlier_removal: { enabled: false, params: { maxSd: 99, minReplicates: 2 } } }, KIT, "compile", "compileRules")
    expect(off.ok && off.data.outlier_removal).toEqual({ enabled: false, params: { maxSd: 5, minReplicates: 2 } })
  })
})

describe("normalisation method", () => {
  const panel = (curves: { measured: boolean; endogenous: boolean }, ruleDefaults = {}): KitPanel => ({
    orientation: "tubes_in_rows",
    ruleDefaults,
    tubes: [
      {
        name: "T1",
        order: 1,
        targets: [
          { name: "A", fluorophore: "FAM", controlType: "none", hasStdCurve: curves.measured },
          { name: "ENT", fluorophore: "HEX", controlType: "endogenous_control", hasStdCurve: curves.endogenous },
        ],
      },
    ],
  })
  const choice = RULES_BY_ID.get("endogenous_normalization")!.choices![0]
  const values = (kit: KitPanel) => availableOptions(kit, choice).map((o) => o.value)

  it("defaults to 2^ΔCt, the AMR portal's method; no choice default needs anything from the kit", () => {
    expect(defaultRuleSettings(panel({ measured: false, endogenous: false }), "compile").endogenous_normalization).toEqual({
      enabled: true,
      params: {},
      choices: { method: "two_power_delta_ct" },
    })
    for (const rule of RULES) {
      for (const c of rule.choices ?? []) expect(c.options.find((o) => o.value === c.default)?.requires, `${rule.id}.${c.key}`).toBeUndefined()
    }
  })

  it("offers the efficiency-corrected ratio only when every target and the endogenous control have a standard curve", () => {
    expect(values(panel({ measured: true, endogenous: true }))).toEqual(["two_power_delta_ct", "efficiency_corrected", "delta_ct"])
    expect(values(panel({ measured: true, endogenous: false }))).toEqual(["two_power_delta_ct", "delta_ct"])
    expect(values(panel({ measured: false, endogenous: true }))).toEqual(["two_power_delta_ct", "delta_ct"])
  })

  it("takes the kit's default method when the kit supports it", () => {
    const kitDefault = { endogenous_normalization: { method: "efficiency_corrected" } }
    expect(defaultRuleSettings(panel({ measured: true, endogenous: true }, kitDefault), "compile").endogenous_normalization.choices).toEqual({
      method: "efficiency_corrected",
    })
    expect(defaultRuleSettings(panel({ measured: false, endogenous: false }, kitDefault), "compile").endogenous_normalization.choices).toEqual({
      method: "two_power_delta_ct",
    })
  })

  it("accepts an offered method and refuses one the kit cannot support", () => {
    const kit = panel({ measured: false, endogenous: false })
    const ok = parseRuleSettings({ endogenous_normalization: { enabled: true, params: {}, choices: { method: "delta_ct" } } }, kit, "compile", "compileRules")
    expect(ok.ok && ok.data.endogenous_normalization.choices).toEqual({ method: "delta_ct" })

    const bad = parseRuleSettings(
      { endogenous_normalization: { enabled: true, params: {}, choices: { method: "efficiency_corrected" } } },
      kit,
      "compile",
      "compileRules"
    )
    expect(bad).toMatchObject({ ok: false, errors: { "compileRules.endogenous_normalization.method": expect.any(String) } })

    // Settings saved before the choice existed fall back to the default.
    const old = parseRuleSettings({ endogenous_normalization: { enabled: true, params: {} } }, kit, "compile", "compileRules")
    expect(old.ok && old.data.endogenous_normalization.choices).toEqual({ method: "two_power_delta_ct" })
  })

  it("reads the method from stored settings, defaulting to 2^ΔCt", () => {
    expect(normalizationMethodOf({ enabled: true, params: {}, choices: { method: "delta_ct" } })).toBe("delta_ct")
    expect(normalizationMethodOf({ enabled: true, params: {} })).toBe("two_power_delta_ct")
    expect(normalizationMethodOf({ enabled: true, params: {}, choices: { method: "nonsense" } })).toBe("two_power_delta_ct")
    expect(normalizationMethodOf(null)).toBe("two_power_delta_ct")
  })
})
