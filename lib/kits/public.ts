import type { SupabaseClient } from "@supabase/supabase-js"

export type LayoutOrientation = "tubes_in_rows" | "tubes_in_columns"

export type KitTargetRow = {
  target_name: string
  fluorophore: string
  control_type: string
  sort_order: number
  tube_name?: string | null
  tube_order?: number | null
  std_slope?: number | null
}

export type KitRow = {
  id: string
  name: string
  version: string
  layout_orientation?: string | null
  rule_defaults?: unknown
  kit_targets: KitTargetRow[] | null
}

export type KitTarget = {
  name: string
  fluorophore: string
  controlType: string
  hasStdCurve: boolean
}

/** A multiplex tube (primer-probe mix): every target in it is read in the same well. */
export type KitTube = { name: string; order: number; targets: KitTarget[] }

/** Rule parameter defaults from the kit insert, keyed by rule id. */
export type RuleDefaults = Record<string, Record<string, unknown>>

/** What the plate layout and rule pickers need to know about a kit. */
export type KitPanel = {
  orientation: LayoutOrientation
  tubes: KitTube[]
  ruleDefaults: RuleDefaults
}

export type KitSummary = KitPanel & {
  id: string
  name: string
  version: string
  targets: { name: string; fluorophore: string }[]
  controls: { name: string; fluorophore: string }[]
}

function toRuleDefaults(value: unknown): RuleDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: RuleDefaults = {}
  for (const [key, params] of Object.entries(value)) {
    if (params && typeof params === "object" && !Array.isArray(params)) out[key] = params as Record<string, unknown>
  }
  return out
}

function groupTubes(ordered: KitTargetRow[]): KitTube[] {
  const tubes = new Map<string, KitTube>()
  for (const t of ordered) {
    const name = t.tube_name || "Tube 1"
    const tube = tubes.get(name) ?? { name, order: t.tube_order ?? 1, targets: [] }
    tube.targets.push({
      name: t.target_name,
      fluorophore: t.fluorophore,
      controlType: t.control_type,
      hasStdCurve: t.std_slope !== null && t.std_slope !== undefined,
    })
    tubes.set(name, tube)
  }
  return [...tubes.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export function summariseKits(rows: KitRow[]): KitSummary[] {
  return rows
    .map((kit) => {
      const ordered = [...(kit.kit_targets ?? [])].sort((a, b) => a.sort_order - b.sort_order)
      const pick = (t: KitTargetRow) => ({ name: t.target_name, fluorophore: t.fluorophore })
      return {
        id: kit.id,
        name: kit.name,
        version: kit.version,
        orientation: (kit.layout_orientation === "tubes_in_columns" ? "tubes_in_columns" : "tubes_in_rows") as LayoutOrientation,
        ruleDefaults: toRuleDefaults(kit.rule_defaults),
        tubes: groupTubes(ordered),
        targets: ordered.filter((t) => t.control_type === "none").map(pick),
        controls: ordered.filter((t) => t.control_type !== "none").map(pick),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const KIT_SELECT =
  "id, name, version, layout_orientation, rule_defaults, kit_targets(target_name, fluorophore, control_type, sort_order, tube_name, tube_order, std_slope)"

/** Active kits and their panels, readable without signing in (for the landing page and onboarding form). */
export async function listActiveKits(supabase: SupabaseClient): Promise<KitSummary[]> {
  const { data, error } = await supabase.from("kits").select(KIT_SELECT).eq("active", true)

  if (error) throw new Error(`Could not load kits: ${error.message}`)
  return summariseKits((data ?? []) as KitRow[])
}
