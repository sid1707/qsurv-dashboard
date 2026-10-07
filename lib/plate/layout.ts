import { z } from "zod"
import type { KitPanel, LayoutOrientation } from "@/lib/kits/public"

export const PLATE_ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const
export const PLATE_COLUMNS = Array.from({ length: 12 }, (_, i) => i + 1)
export const WELL_PATTERN = /^[A-H](?:[1-9]|1[0-2])$/
export const MAX_PLATES = 4

export const WELL_ROLES = [
  { value: "unknown", label: "Unknown", short: "U" },
  { value: "pc", label: "Positive control", short: "PC" },
  { value: "nc", label: "Negative control", short: "NC" },
] as const

export type WellRole = (typeof WELL_ROLES)[number]["value"]
export type Well = { tube: string; role: WellRole }
/** Wells in use on one 96-well plate, keyed by position ("A1".."H12"). Empty wells are absent. */
export type PlateWells = Record<string, Well>
/**
 * `samples` is how many samples share a plate (default 1). Each needs
 * `unknownReplicates` wells per tube, but which unknown wells hold which sample
 * is not fixed: a run is split by the samples' identifiers, not by well.
 */
export type LayoutCounts = { unknownReplicates: number; pc: number; nc: number; samples?: number }

/** Most samples on one plate, as in the AMR plate compositions. */
export const MAX_SAMPLES_PER_PLATE = 3

/**
 * How several samples on one plate differ, which decides how a run is split
 * before validation and compilation: by collection date or by site.
 */
export const MULTI_SAMPLE_MODES = [
  { value: "dates", label: "Multiple dates", description: "The same site sampled on different dates." },
  { value: "sites", label: "Multiple sites", description: "Different sites (e.g. ETP and STP) sampled on the same date." },
] as const
export type MultiSampleMode = (typeof MULTI_SAMPLE_MODES)[number]["value"]

/** Columns of the instrument export that may carry each sample's identifier. */
export const SAMPLE_IDENTIFIER_COLUMNS = ["Sample Name", "Sample", "Biological Set Name"] as const

export const samplesPerPlate = (counts: LayoutCounts) => counts.samples ?? 1

/** Starting counts for a new layout: three replicates, one positive and one negative control. */
export const DEFAULT_COUNTS: LayoutCounts = { unknownReplicates: 3, pc: 1, nc: 1 }

export type PlateLayout = {
  version: 1
  orientation: LayoutOrientation
  counts: LayoutCounts
  plates: PlateWells[]
  /** Present when more than one sample shares a plate. */
  multiSample?: { mode: MultiSampleMode }
}

const ROLE_VALUES = WELL_ROLES.map((r) => r.value) as [WellRole, ...WellRole[]]

export const plateLayoutSchema = z
  .object({
    version: z.literal(1),
    orientation: z.enum(["tubes_in_rows", "tubes_in_columns"]),
    counts: z.object({
      unknownReplicates: z.number().int().min(1).max(12),
      pc: z.number().int().min(0).max(12),
      nc: z.number().int().min(0).max(12),
      samples: z.number().int().min(1).max(MAX_SAMPLES_PER_PLATE).optional(),
    }),
    plates: z
      .array(
        z.record(
          z.string().regex(WELL_PATTERN, "Not a 96-well position."),
          z.object({ tube: z.string().min(1).max(100), role: z.enum(ROLE_VALUES) })
        )
      )
      .min(1)
      .max(MAX_PLATES),
    multiSample: z.object({ mode: z.enum(["dates", "sites"]) }).optional(),
  })
  .refine((l) => (samplesPerPlate(l.counts) > 1) === Boolean(l.multiSample), {
    message: "Choose whether the samples on a plate are from multiple dates or multiple sites.",
    path: ["multiSample"],
  })

/**
 * How the preset puts tubes on a plate. With tubes in rows each tube gets a row
 * of 12 wells (8 tubes per plate); with tubes in columns each tube gets a column
 * of 8 wells (12 tubes per plate).
 */
export function layoutGeometry(orientation: LayoutOrientation) {
  return orientation === "tubes_in_rows"
    ? { wellsPerTube: PLATE_COLUMNS.length, tubesPerPlate: PLATE_ROWS.length }
    : { wellsPerTube: PLATE_ROWS.length, tubesPerPlate: PLATE_COLUMNS.length }
}

/** Most wells one tube can use in the preset: replicates + positive + negative controls. */
export function layoutCapacity(kit: Pick<KitPanel, "orientation">) {
  return layoutGeometry(kit.orientation).wellsPerTube
}

export function platesNeeded(kit: Pick<KitPanel, "orientation" | "tubes">) {
  return Math.max(1, Math.ceil(kit.tubes.length / layoutGeometry(kit.orientation).tubesPerPlate))
}

export function totalWellsPerTube(counts: LayoutCounts) {
  return samplesPerPlate(counts) * counts.unknownReplicates + counts.pc + counts.nc
}

export function countsFit(kit: Pick<KitPanel, "orientation">, counts: LayoutCounts) {
  return totalWellsPerTube(counts) <= layoutCapacity(kit)
}

/** Unknown wells for every sample on the plate, then positive controls, then negative controls. */
function wellAt(index: number, tube: string, counts: LayoutCounts): Well {
  const unknowns = samplesPerPlate(counts) * counts.unknownReplicates
  const role: WellRole = index < unknowns ? "unknown" : index < unknowns + counts.pc ? "pc" : "nc"
  return { tube, role }
}

/**
 * The default layout: each tube on its own row (or column), with the unknown
 * wells first (replicates for every sample on the plate), then positive
 * controls, then negative controls. Several samples default to "multiple dates".
 */
export function presetLayout(
  kit: Pick<KitPanel, "orientation" | "tubes">,
  counts: LayoutCounts,
  mode: MultiSampleMode = "dates"
): PlateLayout {
  const { tubesPerPlate } = layoutGeometry(kit.orientation)
  const total = Math.min(totalWellsPerTube(counts), layoutCapacity(kit))
  const plates: PlateWells[] = Array.from({ length: platesNeeded(kit) }, () => ({}))

  kit.tubes.forEach((tube, i) => {
    const plate = plates[Math.floor(i / tubesPerPlate)]
    const lane = i % tubesPerPlate
    for (let k = 0; k < total; k++) {
      const well =
        kit.orientation === "tubes_in_rows" ? `${PLATE_ROWS[lane]}${k + 1}` : `${PLATE_ROWS[k]}${lane + 1}`
      plate[well] = wellAt(k, tube.name, counts)
    }
  })

  const multi = samplesPerPlate(counts) > 1
  return {
    version: 1,
    orientation: kit.orientation,
    counts: multi ? counts : { unknownReplicates: counts.unknownReplicates, pc: counts.pc, nc: counts.nc },
    plates,
    ...(multi ? { multiSample: { mode } } : {}),
  }
}

/** Sets (or clears, with null) one well. Returns a new layout. */
export function paintWell(layout: PlateLayout, plateIndex: number, well: string, value: Well | null): PlateLayout {
  if (!WELL_PATTERN.test(well) || !layout.plates[plateIndex]) return layout
  const current = layout.plates[plateIndex][well]
  if (value === null ? !current : current?.tube === value.tube && current.role === value.role) return layout
  const plates = layout.plates.map((wells, i) => {
    if (i !== plateIndex) return wells
    const next = { ...wells }
    if (value) next[well] = value
    else delete next[well]
    return next
  })
  return { ...layout, plates }
}

export type RoleCounts = Record<WellRole, number>

export function countRolesByTube(layout: PlateLayout): Map<string, RoleCounts> {
  const out = new Map<string, RoleCounts>()
  for (const wells of layout.plates) {
    for (const well of Object.values(wells)) {
      const counts = out.get(well.tube) ?? { unknown: 0, pc: 0, nc: 0 }
      counts[well.role] += 1
      out.set(well.tube, counts)
    }
  }
  return out
}

/**
 * Checks a layout against the kit: every tube must have exactly the configured
 * number of unknown replicates, positive and negative controls, and every well
 * must belong to one of the kit's tubes. Returns messages, empty when valid.
 */
export function validateLayout(layout: PlateLayout, kit: Pick<KitPanel, "orientation" | "tubes">): string[] {
  const errors: string[] = []
  const tubeNames = new Set(kit.tubes.map((t) => t.name))
  const unknownTubes = new Set<string>()
  for (const wells of layout.plates) {
    for (const well of Object.values(wells)) if (!tubeNames.has(well.tube)) unknownTubes.add(well.tube)
  }
  if (unknownTubes.size > 0) {
    errors.push(`The layout uses tubes that are not in this kit: ${[...unknownTubes].join(", ")}.`)
  }
  if (totalWellsPerTube(layout.counts) > layoutCapacity(kit)) {
    errors.push(`Each tube can use at most ${layoutCapacity(kit)} wells (replicates + controls).`)
  }

  const samples = samplesPerPlate(layout.counts)
  const byTube = countRolesByTube(layout)
  const expected: RoleCounts = {
    unknown: samples * layout.counts.unknownReplicates,
    pc: layout.counts.pc,
    nc: layout.counts.nc,
  }
  for (const tube of kit.tubes) {
    const got = byTube.get(tube.name) ?? { unknown: 0, pc: 0, nc: 0 }
    const wrong = WELL_ROLES.filter((r) => got[r.value] !== expected[r.value]).map(
      (r) => `${got[r.value]} ${r.label.toLowerCase()} (expected ${expected[r.value]})`
    )
    if (wrong.length > 0) errors.push(`${tube.name} has ${wrong.join(", ")}.`)
  }

  return errors
}

// ---------- Plate composition: samples per plate, chosen on each upload ----------

/**
 * What a centre runs on one plate, chosen on each upload as in the AMR portal.
 * The project's layout holds one sample; the others are placed from it.
 */
export type PlateComposition = { samples: number; mode: MultiSampleMode | null }

export const SINGLE_SAMPLE: PlateComposition = { samples: 1, mode: null }

/** Reads a composition from form or JSON input. A missing sample count means one sample. */
export function parsePlateComposition(samples: unknown, mode: unknown): PlateComposition | null {
  const n = samples === undefined || samples === null || samples === "" ? 1 : Number(samples)
  if (!Number.isInteger(n) || n < 1 || n > MAX_SAMPLES_PER_PLATE) return null
  if (n === 1) return mode === undefined || mode === null || mode === "" ? SINGLE_SAMPLE : null
  return mode === "dates" || mode === "sites" ? { samples: n, mode } : null
}

/** Collection dates an upload needs: one per sample on multi-date plates, otherwise one. */
export const compositionDateCount = (c: PlateComposition) => (c.mode === "dates" ? c.samples : 1)

/** Unknown wells and the sample (1, 2, ...) they show, per plate. */
export type SampleWells = Record<string, number>

function lanePosition(orientation: LayoutOrientation, well: string) {
  const row = PLATE_ROWS.indexOf(well[0] as (typeof PLATE_ROWS)[number])
  const column = Number(well.slice(1)) - 1
  return orientation === "tubes_in_rows" ? { lane: row, pos: column } : { lane: column, pos: row }
}

function wellInLane(orientation: LayoutOrientation, lane: number, pos: number) {
  return orientation === "tubes_in_rows" ? `${PLATE_ROWS[lane]}${pos + 1}` : `${PLATE_ROWS[pos]}${lane + 1}`
}

/**
 * The plate for a composition, built from the project's one-sample layout. In
 * every tube the other samples' replicates follow sample 1's unknown wells and
 * the wells after them (the controls) move along the tube's row or column, e.g.
 * S1 S1 S1 S2 S2 S2 PC NC. Null when the extra wells do not fit in the row or
 * column. The sample numbers only illustrate: a run is split by the samples'
 * identifiers, not by well.
 */
export function expandLayout(
  base: PlateLayout,
  composition: PlateComposition
): { layout: PlateLayout; sampleWells: SampleWells[] } | null {
  const { orientation } = base
  const reps = base.counts.unknownReplicates
  const extra = (composition.samples - 1) * reps
  const laneLength = layoutGeometry(orientation).wellsPerTube

  const plates: PlateWells[] = []
  const sampleWells: SampleWells[] = []
  for (const wells of base.plates) {
    const taken = new Set(Object.keys(wells))
    const byTube = new Map<string, string[]>()
    for (const [id, w] of Object.entries(wells)) byTube.set(w.tube, [...(byTube.get(w.tube) ?? []), id])

    const next: PlateWells = {}
    const samples: SampleWells = {}
    for (const [tube, ids] of byTube) {
      const ordered = ids
        .map((id) => ({ id, ...lanePosition(orientation, id) }))
        .sort((a, b) => a.lane - b.lane || a.pos - b.pos)
      const last = ordered[ordered.length - 1]
      const free: string[] = []
      for (let pos = last.pos + 1; pos < laneLength && free.length < extra; pos++) {
        const id = wellInLane(orientation, last.lane, pos)
        if (!taken.has(id)) {
          free.push(id)
          taken.add(id)
        }
      }
      if (free.length < extra) return null

      const roles = ordered.map((o) => wells[o.id].role)
      const split = roles.lastIndexOf("unknown") + 1
      const sequence: { role: WellRole; sample?: number }[] = [
        ...roles.slice(0, split).map((role) => (role === "unknown" ? { role, sample: 1 } : { role })),
        ...Array.from({ length: extra }, (_, k) => ({ role: "unknown" as const, sample: 2 + Math.floor(k / reps) })),
        ...roles.slice(split).map((role) => ({ role })),
      ]
      const positions = [...ordered.map((o) => o.id), ...free]
      sequence.forEach((s, i) => {
        next[positions[i]] = { tube, role: s.role }
        if (s.sample) samples[positions[i]] = s.sample
      })
    }
    plates.push(next)
    sampleWells.push(samples)
  }

  const counts = { unknownReplicates: reps, pc: base.counts.pc, nc: base.counts.nc }
  const multi = composition.samples > 1
  return {
    layout: {
      version: 1,
      orientation,
      counts: multi ? { ...counts, samples: composition.samples } : counts,
      plates,
      ...(multi ? { multiSample: { mode: composition.mode ?? "dates" } } : {}),
    },
    sampleWells,
  }
}

/** Most samples the layout can carry on one plate (at least 1). */
export function maxSamplesFor(base: PlateLayout) {
  for (let n = MAX_SAMPLES_PER_PLATE; n > 1; n--) {
    if (expandLayout(base, { samples: n, mode: "dates" })) return n
  }
  return 1
}

/** Parses and checks a layout in one go. */
export function parseLayout(value: unknown, kit: Pick<KitPanel, "orientation" | "tubes">) {
  const parsed = plateLayoutSchema.safeParse(value)
  if (!parsed.success) return { ok: false as const, errors: ["Set up the plate layout."] }
  const errors = validateLayout(parsed.data, kit)
  return errors.length > 0 ? { ok: false as const, errors } : { ok: true as const, data: parsed.data }
}
