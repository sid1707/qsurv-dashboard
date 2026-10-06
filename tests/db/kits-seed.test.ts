import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb } from "./harness"

type TargetRow = {
  kit: string
  tube_name: string
  tube_order: number
  target_name: string
  fluorophore: string
  control_type: string
  std_slope: number | null
}

let db: PGlite
let targets: TargetRow[]

beforeAll(async () => {
  db = await createMigratedDb()
  const result = await db.query<TargetRow>(
    `select k.name as kit, t.tube_name, t.tube_order, t.target_name, t.fluorophore,
            t.control_type::text as control_type, t.std_slope
     from public.kit_targets t join public.kits k on k.id = t.kit_id
     where k.active
     order by k.name, t.sort_order`
  )
  targets = result.rows
}, 60_000)

const forKit = (name: string) => targets.filter((t) => t.kit === name)
const tubes = (rows: TargetRow[]) => [...new Set(rows.map((t) => t.tube_order))]

describe("seeded Quantiplus kits", () => {
  it.each([
    ["Quantiplus ENV-AMR (8 tube)", 8, 23, "tubes_in_rows"],
    ["Quantiplus ENV-AMR V2 (15 tube)", 15, 35, "tubes_in_rows"],
    ["Quantiplus Waste Water Surveillance (10 tube)", 10, 22, "tubes_in_columns"],
  ])("%s has %i tubes and %i targets", async (name, tubeCount, targetCount, orientation) => {
    const rows = forKit(name)
    expect(tubes(rows)).toHaveLength(tubeCount)
    expect(rows).toHaveLength(targetCount)
    const kit = await db.query<{ layout_orientation: string }>(
      "select layout_orientation from public.kits where name = $1",
      [name]
    )
    expect(kit.rows[0].layout_orientation).toBe(orientation)
  })

  it("never reads two targets with the same dye in one tube", () => {
    const seen = new Set<string>()
    for (const t of targets) {
      const key = `${t.kit}|${t.tube_name}|${t.fluorophore}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
    }
  })

  it("has exactly one exogenous and one endogenous control per kit", () => {
    for (const kit of new Set(targets.map((t) => t.kit))) {
      const rows = forKit(kit)
      expect(rows.filter((t) => t.control_type === "exogenous_control"), kit).toHaveLength(1)
      expect(rows.filter((t) => t.control_type === "endogenous_control"), kit).toHaveLength(1)
    }
  })

  it("matches the insert's dye mapping for a few targets", () => {
    const find = (kit: string, target: string) => forKit(kit).find((t) => t.target_name === target)
    expect(find("Quantiplus ENV-AMR (8 tube)", "VIM")).toMatchObject({ tube_name: "NVK", fluorophore: "Texas Red/ROX" })
    expect(find("Quantiplus ENV-AMR V2 (15 tube)", "Klebsiella pneumoniae")).toMatchObject({ fluorophore: "Cy5" })
    expect(find("Quantiplus Waste Water Surveillance (10 tube)", "Influenza B")).toMatchObject({
      tube_name: "RP1 PPM 1",
      fluorophore: "Cy5",
    })
  })

  it("sets standard curves only on the 8-tube ENV-AMR kit", () => {
    expect(forKit("Quantiplus ENV-AMR (8 tube)").every((t) => t.std_slope !== null)).toBe(true)
    expect(forKit("Quantiplus ENV-AMR V2 (15 tube)").every((t) => t.std_slope === null)).toBe(true)
  })

  it("keeps the placeholder kits but hides them from the form", async () => {
    const rows = await db.query<{ active: boolean }>(
      "select active from public.kits where version = '0.1-placeholder'"
    )
    expect(rows.rows.map((r) => r.active)).toEqual([false, false])
  })
})
