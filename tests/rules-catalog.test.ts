import { describe, expect, it } from "vitest"
import type { KitPanel } from "../lib/kits/public"
import { RULES, availableRules, defaultRuleSettings, parseRuleSettings } from "../lib/rules/catalog"
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
