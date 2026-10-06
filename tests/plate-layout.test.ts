import { describe, expect, it } from "vitest"
import type { KitPanel, KitTube } from "../lib/kits/public"
import {
  countRolesByTube,
  layoutCapacity,
  paintWell,
  parseLayout,
  platesNeeded,
  presetLayout,
  validateLayout,
} from "../lib/plate/layout"

const tubes = (n: number): KitTube[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `T${i + 1}`,
    order: i + 1,
    targets: [{ name: `target ${i + 1}`, fluorophore: "FAM", controlType: "none", hasStdCurve: false }],
  }))

const kit = (n: number, orientation: KitPanel["orientation"]): KitPanel => ({ orientation, tubes: tubes(n), ruleDefaults: {} })
const counts = { unknownReplicates: 3, pc: 1, nc: 1 }

describe("presetLayout", () => {
  it("puts an 8-tube kit one tube per row: unknowns, then PC, then NC across columns", () => {
    const layout = presetLayout(kit(8, "tubes_in_rows"), counts)
    expect(layout.plates).toHaveLength(1)
    const plate = layout.plates[0]
    expect(plate.A1).toEqual({ tube: "T1", role: "unknown" })
    expect(plate.A3).toEqual({ tube: "T1", role: "unknown" })
    expect(plate.A4).toEqual({ tube: "T1", role: "pc" })
    expect(plate.A5).toEqual({ tube: "T1", role: "nc" })
    expect(plate.A6).toBeUndefined()
    expect(plate.H5).toEqual({ tube: "T8", role: "nc" })
    expect(Object.keys(plate)).toHaveLength(8 * 5)
  })

  it("puts a 10-tube kit one tube per column: unknowns, then PC, then NC down the rows", () => {
    const layout = presetLayout(kit(10, "tubes_in_columns"), counts)
    expect(layout.plates).toHaveLength(1)
    const plate = layout.plates[0]
    expect(plate.A1).toEqual({ tube: "T1", role: "unknown" })
    expect(plate.C1).toEqual({ tube: "T1", role: "unknown" })
    expect(plate.D1).toEqual({ tube: "T1", role: "pc" })
    expect(plate.E1).toEqual({ tube: "T1", role: "nc" })
    expect(plate.A10).toEqual({ tube: "T10", role: "unknown" })
    expect(plate.A11).toBeUndefined()
  })

  it("spreads a 15-tube kit over two plates, 8 tubes then 7", () => {
    const k = kit(15, "tubes_in_rows")
    const layout = presetLayout(k, counts)
    expect(platesNeeded(k)).toBe(2)
    expect(layout.plates).toHaveLength(2)
    expect(layout.plates[0].H1.tube).toBe("T8")
    expect(layout.plates[1].A1.tube).toBe("T9")
    expect(layout.plates[1].G1.tube).toBe("T15")
    expect(layout.plates[1].H1).toBeUndefined()
    expect(validateLayout(layout, k)).toEqual([])
  })

  it("limits wells per tube by orientation", () => {
    expect(layoutCapacity({ orientation: "tubes_in_rows" })).toBe(12)
    expect(layoutCapacity({ orientation: "tubes_in_columns" })).toBe(8)
  })
})

describe("editing and validating a layout", () => {
  const k = kit(2, "tubes_in_rows")

  it("paints and clears wells without mutating the original", () => {
    const layout = presetLayout(k, counts)
    const moved = paintWell(paintWell(layout, 0, "A5", null), 0, "A12", { tube: "T1", role: "nc" })
    expect(layout.plates[0].A5).toEqual({ tube: "T1", role: "nc" })
    expect(moved.plates[0].A5).toBeUndefined()
    expect(moved.plates[0].A12).toEqual({ tube: "T1", role: "nc" })
    expect(validateLayout(moved, k)).toEqual([])
  })

  it("ignores invalid wells and plates", () => {
    const layout = presetLayout(k, counts)
    expect(paintWell(layout, 0, "I1", null)).toBe(layout)
    expect(paintWell(layout, 3, "A1", null)).toBe(layout)
  })

  it("reports tubes with the wrong number of wells per role", () => {
    const layout = paintWell(presetLayout(k, counts), 0, "B4", { tube: "T2", role: "unknown" })
    expect(countRolesByTube(layout).get("T2")).toEqual({ unknown: 4, pc: 0, nc: 1 })
    const errors = validateLayout(layout, k)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/T2 has 4 unknown \(expected 3\), 0 positive control \(expected 1\)/)
  })

  it("rejects wells for tubes that are not in the kit", () => {
    const layout = paintWell(presetLayout(k, counts), 0, "C1", { tube: "Other", role: "unknown" })
    expect(validateLayout(layout, k)[0]).toMatch(/not in this kit: Other/)
  })

  it("rejects malformed layouts", () => {
    expect(parseLayout(null, k).ok).toBe(false)
    expect(parseLayout({ version: 1, orientation: "tubes_in_rows", counts, plates: [{ Z9: { tube: "T1", role: "unknown" } }] }, k).ok).toBe(false)
    expect(parseLayout(presetLayout(k, counts), k).ok).toBe(true)
  })
})

describe("several samples on one plate", () => {
  const two = { unknownReplicates: 3, pc: 1, nc: 1, samples: 2 }

  it("gives each tube unknown wells for every sample, then the shared controls, without tying wells to samples", () => {
    const layout = presetLayout(kit(8, "tubes_in_rows"), two, "sites")
    const plate = layout.plates[0]
    for (const well of ["A1", "A3", "A4", "A6"]) expect(plate[well]).toEqual({ tube: "T1", role: "unknown" })
    expect(plate.A7).toEqual({ tube: "T1", role: "pc" })
    expect(plate.A8).toEqual({ tube: "T1", role: "nc" })
    expect(plate.A9).toBeUndefined()
    expect(layout.multiSample).toEqual({ mode: "sites" })
    expect(validateLayout(layout, kit(8, "tubes_in_rows"))).toEqual([])
    expect(parseLayout(layout, kit(8, "tubes_in_rows")).ok).toBe(true)
  })

  it("keeps single-sample layouts as they were", () => {
    const layout = presetLayout(kit(8, "tubes_in_rows"), counts)
    expect(layout.multiSample).toBeUndefined()
    expect(layout.counts).toEqual(counts)
    expect(layout.plates[0].A1).toEqual({ tube: "T1", role: "unknown" })
  })

  it("does not fit three samples in a column of 8 wells", () => {
    const k = kit(10, "tubes_in_columns")
    expect(validateLayout(presetLayout(k, { ...two, samples: 3 }), k)).toContain(
      "Each tube can use at most 8 wells (replicates + controls)."
    )
    expect(validateLayout(presetLayout(k, two), k)).toEqual([])
  })

  it("needs replicates for every sample in every tube", () => {
    const k = kit(1, "tubes_in_rows")
    const short = paintWell(presetLayout(k, two), 0, "A6", null)
    expect(validateLayout(short, k)).toEqual(["T1 has 5 unknown (expected 6)."])
  })

  it("needs the dates-or-sites choice whenever there are several samples", () => {
    const k = kit(1, "tubes_in_rows")
    const layout = presetLayout(k, two)
    const { multiSample: _mode, ...withoutMode } = layout
    void _mode
    expect(parseLayout(withoutMode, k).ok).toBe(false)
  })
})
