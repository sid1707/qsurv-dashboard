import { summariseKits, type KitRow } from "../lib/kits/public"
import { EMPTY_ONBOARDING_VALUES, type OnboardingValues } from "../lib/onboarding/schema"
import { presetLayout } from "../lib/plate/layout"
import { defaultRuleSettings } from "../lib/rules/catalog"

export const KIT_ID = "5f0c6f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f"

/** A small two-tube kit with both kinds of internal control, as Supabase returns it. */
export const KIT_ROW: KitRow = {
  id: KIT_ID,
  name: "Test AMR kit",
  version: "1",
  layout_orientation: "tubes_in_rows",
  rule_defaults: { ntc_amplification: { ct: 37 }, low_ct_clamp: { targetOverrides: { MTB: 20 } } },
  kit_targets: [
    { target_name: "NDM", fluorophore: "FAM", control_type: "none", sort_order: 1, tube_name: "NVK", tube_order: 1, std_slope: -3.3 },
    { target_name: "IC", fluorophore: "Texas Red/ROX", control_type: "exogenous_control", sort_order: 2, tube_name: "NVK", tube_order: 1, std_slope: null },
    { target_name: "MTB", fluorophore: "FAM", control_type: "none", sort_order: 3, tube_name: "MTB", tube_order: 2, std_slope: -3.1 },
    { target_name: "ENT", fluorophore: "VIC/HEX", control_type: "endogenous_control", sort_order: 4, tube_name: "MTB", tube_order: 2, std_slope: null },
  ],
}

export const KIT = summariseKits([KIT_ROW])[0]

export const COUNTS = { unknownReplicates: 3, pc: 1, nc: 1 }

export function validValues(overrides: Partial<OnboardingValues> = {}): OnboardingValues {
  return {
    ...EMPTY_ONBOARDING_VALUES,
    fullName: "Asha Rao",
    designation: "Principal Investigator",
    email: "Asha.Rao@Example.org ",
    password: "correct-horse-battery",
    confirmPassword: "correct-horse-battery",
    phone: "+91 98765 43210",
    institutionName: "Regional Biosurveillance Lab",
    city: "Bengaluru",
    state: "Karnataka",
    projectTitle: "Urban wastewater AMR surveillance",
    shortCode: "rbl-amr",
    objective: "Track resistance genes in urban wastewater across partner centres.",
    startDate: "2026-11-01",
    endDate: "2027-10-31",
    sampleType: "wastewater",
    frequency: "weekly",
    kitId: KIT_ID,
    instruments: ["quantstudio_5"],
    centres: [
      { name: "Centre North", city: "Mysuru", contactEmail: "north@example.org" },
      { name: "", city: "", contactEmail: "" },
    ],
    userTier: "under_20",
    plateLayout: presetLayout(KIT, COUNTS),
    qcRules: defaultRuleSettings(KIT, "qc"),
    compileRules: defaultRuleSettings(KIT, "compile"),
    dataManagement: true,
    dataCompilation: true,
    dataPlotting: false,
    consent: true,
    ...overrides,
  }
}
