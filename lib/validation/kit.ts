/**
 * The kit as the validation engine sees it, built from kit_targets rows. This
 * replaces vrdl-next-platform's hardcoded TARGET_ALIASES, CANONICAL_QPCR_TARGETS,
 * ARG_TARGETS fluorophores and per-target Ct cut-offs.
 */

export type KitTargetRow = {
  target_name: string
  aliases: string[] | null
  fluorophore: string
  control_type: string
  ct_min: number | string | null
  ct_max: number | string | null
  tube_name: string | null
  tube_order: number | null
  sort_order: number
}

export type KitTargetSpec = {
  name: string
  aliases: string[]
  /** Accepted dye names, normalised. "VIC/HEX" accepts VIC or HEX. */
  fluorophores: Set<string>
  /** As written in the kit, for messages. */
  fluorophoreLabel: string
  controlType: string
  ctMin: number | null
  ctMax: number | null
  tube: string
}

export type ValidationKit = {
  name: string
  targets: KitTargetSpec[]
  /** Normalised name or alias → target. */
  resolve: (raw: unknown) => KitTargetSpec | undefined
  byName: Map<string, KitTargetSpec>
}

/** vrdl-next-platform's target matching: trimmed, case-insensitive, hyphens ignored. */
export function normTarget(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/-/g, "")
}

/** Dye names compared without case or spaces, so "Texas Red" matches "TexasRed". */
export function normFluor(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "")
}

const num = (v: number | string | null) => (v === null || v === "" ? null : Number(v))

export function buildValidationKit(name: string, rows: KitTargetRow[]): ValidationKit {
  const targets = [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map<KitTargetSpec>((r) => ({
      name: r.target_name,
      aliases: r.aliases ?? [],
      fluorophores: new Set(r.fluorophore.split("/").map(normFluor).filter(Boolean)),
      fluorophoreLabel: r.fluorophore,
      controlType: r.control_type,
      ctMin: num(r.ct_min),
      ctMax: num(r.ct_max),
      tube: r.tube_name || "Tube 1",
    }))

  const index = new Map<string, KitTargetSpec>()
  // Names win over aliases when an alias of one target equals another's name.
  for (const t of targets) for (const alias of t.aliases) if (!index.has(normTarget(alias))) index.set(normTarget(alias), t)
  for (const t of targets) index.set(normTarget(t.name), t)

  return {
    name,
    targets,
    resolve: (raw) => index.get(normTarget(raw)),
    byName: new Map(targets.map((t) => [t.name, t])),
  }
}

export const isExogenous = (t: KitTargetSpec) => t.controlType === "exogenous_control"
export const isEndogenous = (t: KitTargetSpec) => t.controlType === "endogenous_control"
/** Any internal control (including the generic type used by older kits). */
export const isInternalControl = (t: KitTargetSpec) => t.controlType !== "none"
