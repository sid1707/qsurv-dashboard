import { describe, expect, it } from "vitest"
import {
  EMPTY_TARGET,
  parseAliases,
  parseList,
  toSaveKitArgs,
  validateKitForm,
  type KitFormValues,
  type TargetFormRow,
} from "../lib/kits/schema"

const KIT_ID = "7b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"

function target(overrides: Partial<TargetFormRow> = {}): TargetFormRow {
  return { ...EMPTY_TARGET, targetName: "Target A", fluorophore: "FAM", wells: "A1, B1", ctMin: "12", ctMax: "38", ...overrides }
}

function kit(targets: TargetFormRow[], overrides: Partial<KitFormValues> = {}): KitFormValues {
  return { id: "", name: "Kit", version: "1.0", active: true, layoutOrientation: "tubes_in_rows", targets, ...overrides }
}

describe("parseList and parseAliases", () => {
  it("splits wells on commas and spaces, uppercases and de-duplicates", () => {
    expect(parseList("a1, B1  b1;c12", { upper: true })).toEqual(["A1", "B1", "C12"])
  })

  it("keeps spaces inside aliases", () => {
    expect(parseAliases("Target A, TGT A ; ,Target A")).toEqual(["Target A", "TGT A"])
  })
})

describe("validateKitForm", () => {
  it("accepts a valid kit", () => {
    expect(validateKitForm(kit([target(), target({ targetName: "IC", fluorophore: "Cy5", controlType: "internal_control" })])).ok).toBe(true)
  })

  it.each([
    ["no targets", kit([]), "targets"],
    ["a missing name", kit([target()], { name: " " }), "name"],
    ["a well outside the plate", kit([target({ wells: "A1, I1, A13" })]), "targets.0.wells"],
    ["an unknown layout orientation", kit([target()], { layoutOrientation: "diagonal" }), "layoutOrientation"],
    ["a blank tube", kit([target({ tubeName: " " })]), "targets.0.tubeName"],
    ["a non-integer tube order", kit([target({ tubeOrder: "1.5" })]), "targets.0.tubeOrder"],
    [
      "two targets with the same dye in one tube",
      kit([target({ wells: "" }), target({ targetName: "B", wells: "" })]),
      "targets.1.fluorophore",
    ],
    [
      "one tube with two orders",
      kit([target(), target({ targetName: "B", fluorophore: "HEX", tubeOrder: "2" })]),
      "targets.1.tubeOrder",
    ],
    ["a slope without an intercept", kit([target({ stdSlope: "-3.3" })]), "targets.0.stdIntercept"],
    ["a positive slope", kit([target({ stdSlope: "3.3", stdIntercept: "40" })]), "targets.0.stdSlope"],
    ["zero PC copies", kit([target({ pcCopies: "0" })]), "targets.0.pcCopies"],
    ["duplicate target names", kit([target(), target({ targetName: "target a", fluorophore: "HEX" })]), "targets.1.targetName"],
    ["two targets with the same dye in the same well", kit([target(), target({ targetName: "B", wells: "B1" })]), "targets.1.wells"],
    ["min Ct above max Ct", kit([target({ ctMin: "40", ctMax: "30" })]), "targets.0.ctMax"],
    ["a non-numeric Ct", kit([target({ ctMin: "abc" })]), "targets.0.ctMin"],
    ["a Ct above 50", kit([target({ ctMax: "60" })]), "targets.0.ctMax"],
    ["an unknown control type", kit([target({ controlType: "mystery" })]), "targets.0.controlType"],
    ["a malformed kit id", kit([target()], { id: "nope" }), "id"],
  ])("rejects %s", (_label, values, field) => {
    const result = validateKitForm(values)
    expect(result.ok).toBe(false)
    expect(Object.keys(result.errors)).toContain(field)
  })

  it("allows targets without default wells (layouts are designed per project)", () => {
    expect(validateKitForm(kit([target({ wells: "" })])).ok).toBe(true)
  })

  it("allows the same dye in different tubes", () => {
    expect(validateKitForm(kit([target({ wells: "" }), target({ targetName: "B", wells: "", tubeName: "T2", tubeOrder: "2" })])).ok).toBe(true)
  })

  it("allows the same well for different dyes (multiplexing)", () => {
    expect(validateKitForm(kit([target(), target({ targetName: "B", fluorophore: "HEX", wells: "A1" })])).ok).toBe(true)
  })
})

describe("toSaveKitArgs", () => {
  it("builds the save_kit arguments with row order as sort order", () => {
    const result = validateKitForm(
      kit(
        [
          target({ id: "", aliases: "TA, Target-A", channel: "", ctMin: "", wells: "a1 b1" }),
          target({
            targetName: "IC",
            fluorophore: "Cy5",
            controlType: "exogenous_control",
            stdSlope: "-3.1",
            stdIntercept: "40.8",
            pcCopies: "1e5",
          }),
        ],
        { id: KIT_ID }
      )
    )
    if (!result.ok) throw new Error("expected valid")
    const args = toSaveKitArgs(result.data)
    expect(args.p_kit).toEqual({
      id: KIT_ID,
      name: "Kit",
      version: "1.0",
      active: true,
      layout_orientation: "tubes_in_rows",
    })
    expect(args.p_targets[0]).toEqual({
      id: null,
      target_name: "Target A",
      aliases: ["TA", "Target-A"],
      fluorophore: "FAM",
      channel: null,
      plate_wells: ["A1", "B1"],
      control_type: "none",
      ct_min: null,
      ct_max: 38,
      sort_order: 1,
      tube_name: "Tube 1",
      tube_order: 1,
      std_slope: null,
      std_intercept: null,
      pc_copies: null,
    })
    expect(args.p_targets[1]).toMatchObject({
      target_name: "IC",
      control_type: "exogenous_control",
      sort_order: 2,
      std_slope: -3.1,
      std_intercept: 40.8,
      pc_copies: 100000,
    })
  })
})
