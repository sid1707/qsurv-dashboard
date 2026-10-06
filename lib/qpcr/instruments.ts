import { INSTRUMENTS } from "@/lib/onboarding/schema"

export type InstrumentId = (typeof INSTRUMENTS)[number]["value"]

/**
 * What QSurv knows about each instrument on the onboarding form: the native
 * run file it saves, and how to recognise its results export (CSV) so a file
 * from the wrong instrument is caught. "Other" accepts any known run file and
 * any export with the usual columns.
 */
export type InstrumentProfile = {
  id: InstrumentId
  label: string
  runfileExtensions: string[]
  exportHint: string
  /** True when the export's header row looks like this instrument's. */
  matchesHeaders: (normalisedHeaders: Set<string>) => boolean
}

const has = (headers: Set<string>, ...names: string[]) => names.every((n) => headers.has(n))

export const INSTRUMENT_PROFILES: Record<InstrumentId, InstrumentProfile> = {
  quantstudio_5: {
    id: "quantstudio_5",
    label: "QuantStudio 5",
    runfileExtensions: [".eds"],
    exportHint: "In Design & Analysis, export Results as a .csv file. The run file is the .eds file.",
    // Results export: Well, Well Position, Sample Name, Target Name, Task, Reporter, CT ...
    matchesHeaders: (h) => has(h, "wellposition", "reporter") || has(h, "task", "reporter", "targetname"),
  },
  biorad_cfx96: {
    id: "biorad_cfx96",
    label: "Bio-Rad CFX96",
    runfileExtensions: [".pcrd"],
    exportHint: "In CFX Maestro, export Quantification Cq Results as a .csv file. The run file is the .pcrd file.",
    // Quantification Cq Results: Well, Fluor, Target, Content, Sample, Cq ...
    matchesHeaders: (h) => has(h, "fluor", "content", "cq"),
  },
  other: {
    id: "other",
    label: "Other",
    runfileExtensions: [".eds", ".pcrd", ".lc96p", ".rdml", ".rex"],
    exportHint: "Export the results table as a .csv file with well, sample, target, fluorophore and Ct columns.",
    matchesHeaders: () => false,
  },
}

export function isInstrumentId(value: unknown): value is InstrumentId {
  return typeof value === "string" && value in INSTRUMENT_PROFILES
}

/** The instruments a project chose at onboarding. Falls back to the legacy single column. */
export function projectInstruments(project: { instruments: string[] | null; instrument: string | null }): InstrumentId[] {
  const list = project.instruments?.length ? project.instruments : project.instrument ? [project.instrument] : []
  const valid = list.filter(isInstrumentId)
  return valid.length > 0 ? valid : ["other"]
}

export function instrumentOptionLabel(id: InstrumentId, other: string | null) {
  return id === "other" && other ? `Other: ${other}` : INSTRUMENT_PROFILES[id].label
}

const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_.-]/g, "")

/** Which known instrument produced an export, from its header row. Null when it cannot tell. */
export function detectInstrument(headers: string[]): Exclude<InstrumentId, "other"> | null {
  const set = new Set(headers.map(normaliseHeader))
  if (INSTRUMENT_PROFILES.biorad_cfx96.matchesHeaders(set)) return "biorad_cfx96"
  if (INSTRUMENT_PROFILES.quantstudio_5.matchesHeaders(set)) return "quantstudio_5"
  return null
}

export function fileExtension(filename: string) {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/)
  return match ? match[0] : ""
}
