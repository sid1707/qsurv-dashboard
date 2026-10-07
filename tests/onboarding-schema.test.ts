import { describe, expect, it } from "vitest"
import { STEP, parseOnboarding, validateStep, type OnboardingValues } from "../lib/onboarding/schema"
import { paintWell, presetLayout } from "../lib/plate/layout"
import { COUNTS, KIT, validValues } from "./onboarding-fixtures"

describe("onboarding schema", () => {
  it("accepts a complete form and normalises values", () => {
    const result = parseOnboarding(validValues(), KIT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.email).toBe("asha.rao@example.org")
    expect(result.data.shortCode).toBe("RBL-AMR")
    // Empty optional centre rows are dropped.
    expect(result.data.centres).toEqual([
      { name: "Centre North", city: "Mysuru", contactEmail: "north@example.org" },
    ])
    expect(result.data.plateLayout.counts).toEqual(COUNTS)
    expect(result.data.qcRules.required_columns.enabled).toBe(true)
  })

  it("treats project dates as optional", () => {
    const result = parseOnboarding(validValues({ startDate: "", endDate: "" }), KIT)
    expect(result.ok).toBe(true)
    if (result.ok) expect([result.data.startDate, result.data.endDate]).toEqual([null, null])

    expect(validateStep(STEP.project, validValues({ startDate: "2026-11-01", endDate: "" })).ok).toBe(true)
  })

  it("keeps several instruments, in a stable order and without duplicates", () => {
    const result = parseOnboarding(
      validValues({ instruments: ["biorad_cfx96", "quantstudio_5", "biorad_cfx96"] }),
      KIT
    )
    expect(result.ok && result.data.instruments).toEqual(["quantstudio_5", "biorad_cfx96"])
  })

  it.each([
    [0, { fullName: "" }, "fullName"],
    [0, { email: "not-an-email" }, "email"],
    [0, { password: "short", confirmPassword: "short" }, "password"],
    [0, { confirmPassword: "something-else" }, "confirmPassword"],
    [0, { phone: "call me" }, "phone"],
    [1, { institutionName: "  " }, "institutionName"],
    [2, { shortCode: "-BAD" }, "shortCode"],
    [2, { shortCode: "HAS SPACE" }, "shortCode"],
    [2, { endDate: "2026-10-01" }, "endDate"],
    [2, { startDate: "01/11/2026" }, "startDate"],
    [2, { sampleType: "soil" }, "sampleType"],
    [2, { sampleType: "other", sampleTypeOther: "" }, "sampleTypeOther"],
    [2, { frequency: "daily" }, "frequency"],
    [3, { kitId: "" }, "kitId"],
    [3, { instruments: [] }, "instruments"],
    [3, { instruments: ["lightcycler"] }, "instruments.0"],
    [3, { instruments: ["quantstudio_5", "other"], instrumentOther: "" }, "instrumentOther"],
    [3, { centres: [{ name: "", city: "Pune", contactEmail: "" }] }, "centres.0.name"],
    [3, { centres: [{ name: "A", city: "", contactEmail: "nope" }] }, "centres.0.contactEmail"],
    [3, { userTier: "" }, "userTier"],
    [4, { plateLayout: null }, "plateLayout"],
    [5, { compileRules: { outlier_removal: { enabled: true, params: { maxSd: 0, minReplicates: 2 } } } }, "compileRules.outlier_removal.maxSd"],
    [6, { dataManagement: false, dataCompilation: false, dataPlotting: false }, "dataManagement"],
    [6, { consent: false }, "consent"],
  ] as [number, Partial<OnboardingValues>, string][])("step %i rejects %o on %s", (step, overrides, field) => {
    const result = validateStep(step, validValues(overrides), KIT)
    expect(result.ok).toBe(false)
    expect(Object.keys(result.errors)).toContain(field)
  })

  it("rejects a layout that does not match the replicate counts", () => {
    const layout = paintWell(presetLayout(KIT, COUNTS), 0, "A4", null)
    const result = validateStep(STEP.layout, validValues({ plateLayout: layout }), KIT)
    expect(result.errors.plateLayout).toMatch(/NVK has 3 unknown \(expected 3\)|NVK has 0 positive control/)
  })

  it("takes a one-sample layout only: centres choose samples per plate on upload", () => {
    const twoSamples = presetLayout(KIT, { ...COUNTS, samples: 2 }, "dates")
    const result = validateStep(STEP.layout, validValues({ plateLayout: twoSamples }), KIT)
    expect(result.errors.plateLayout).toBe("Set up the layout for one sample per plate.")
  })

  it("needs a kit to check the layout and rules", () => {
    expect(validateStep(STEP.layout, validValues(), null).errors).toHaveProperty("kitId")
    expect(validateStep(STEP.rules, validValues(), null).errors).toHaveProperty("kitId")
  })

  it("reports the first failing step when parsing the whole form", () => {
    const result = parseOnboarding(validValues({ projectTitle: "", consent: false }), KIT)
    expect(result).toMatchObject({ ok: false, step: STEP.project })
  })

  it("ignores unexpected fields", () => {
    const result = parseOnboarding({ ...validValues(), status: "approved", is_super_admin: true }, KIT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).not.toHaveProperty("is_super_admin")
  })
})
