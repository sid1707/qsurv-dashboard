import { describe, expect, it } from "vitest"
import { summariseKits, type KitRow } from "../lib/kits/public"

describe("summariseKits", () => {
  it("orders targets, separates controls and sorts kits by name", () => {
    const rows: KitRow[] = [
      {
        id: "k2",
        name: "Multipathogen",
        version: "1",
        kit_targets: [
          { target_name: "IC", fluorophore: "Cy5", control_type: "internal_control", sort_order: 3 },
          { target_name: "B", fluorophore: "HEX", control_type: "none", sort_order: 2 },
          { target_name: "A", fluorophore: "FAM", control_type: "none", sort_order: 1 },
        ],
      },
      { id: "k1", name: "Environmental", version: "1", kit_targets: null },
    ]

    const [env, multi] = summariseKits(rows)
    expect(env).toMatchObject({ id: "k1", name: "Environmental", targets: [], controls: [], tubes: [] })
    expect(multi).toMatchObject({
      id: "k2",
      targets: [
        { name: "A", fluorophore: "FAM" },
        { name: "B", fluorophore: "HEX" },
      ],
      controls: [{ name: "IC", fluorophore: "Cy5" }],
    })
    // Targets without a tube fall into one default tube; orientation defaults to rows.
    expect(multi.orientation).toBe("tubes_in_rows")
    expect(multi.tubes.map((t) => [t.name, t.targets.map((x) => x.name)])).toEqual([["Tube 1", ["A", "B", "IC"]]])
  })

  it("groups targets into tubes in tube order and keeps kit rule defaults", () => {
    const [kit] = summariseKits([
      {
        id: "k",
        name: "Kit",
        version: "1",
        layout_orientation: "tubes_in_columns",
        rule_defaults: { ntc_amplification: { ct: 38 }, broken: 5 },
        kit_targets: [
          { target_name: "Rota", fluorophore: "FAM", control_type: "none", sort_order: 3, tube_name: "Rota PPM", tube_order: 2, std_slope: null },
          { target_name: "PMMoV", fluorophore: "VIC/HEX", control_type: "endogenous_control", sort_order: 4, tube_name: "Rota PPM", tube_order: 2 },
          { target_name: "SARS-CoV-2", fluorophore: "FAM", control_type: "none", sort_order: 1, tube_name: "RP1 PPM 1", tube_order: 1, std_slope: -3.2 },
        ],
      },
    ])
    expect(kit.orientation).toBe("tubes_in_columns")
    expect(kit.ruleDefaults).toEqual({ ntc_amplification: { ct: 38 } })
    expect(kit.tubes).toEqual([
      {
        name: "RP1 PPM 1",
        order: 1,
        targets: [{ name: "SARS-CoV-2", fluorophore: "FAM", controlType: "none", hasStdCurve: true }],
      },
      {
        name: "Rota PPM",
        order: 2,
        targets: [
          { name: "Rota", fluorophore: "FAM", controlType: "none", hasStdCurve: false },
          { name: "PMMoV", fluorophore: "VIC/HEX", controlType: "endogenous_control", hasStdCurve: false },
        ],
      },
    ])
  })
})
