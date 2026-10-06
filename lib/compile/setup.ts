import type { SupabaseClient } from "@supabase/supabase-js"
import type { KitRow } from "@/lib/kits/public"
import type { PlateLayout } from "@/lib/plate/layout"
import { defaultRuleSettings, parseRuleSettings, type RuleSettings } from "@/lib/rules/catalog"
import type { KitTargetRow, ValidationKit } from "@/lib/validation/kit"
import { buildValidationSetup } from "@/lib/validation/setup"

/** A kit target's database id and standard curve, keyed by target name. */
export type CompileTargetMeta = { id: string; stdSlope: number | null; stdIntercept: number | null }

/** Everything compilation needs for one project: the kit, its plate layout and the compile rules. */
export type CompileSetup = {
  kit: ValidationKit
  layout: PlateLayout
  rules: RuleSettings
  targets: Map<string, CompileTargetMeta>
  /** Set when the stored rules could not be used and the kit defaults stand in. */
  notes: string[]
}

type CompileKitTargetRow = KitTargetRow & {
  id: string
  std_slope: number | string | null
  std_intercept: number | string | null
}
export type CompileKitRow = Omit<KitRow, "kit_targets"> & { kit_targets: CompileKitTargetRow[] | null }

const COMPILE_KIT_SELECT =
  "id, name, version, layout_orientation, rule_defaults, kit_targets(id, target_name, aliases, fluorophore, control_type, ct_min, ct_max, sort_order, tube_name, tube_order, std_slope, std_intercept)"

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v))

/**
 * The validation setup supplies the kit and layout (so rows get the same roles
 * they had when the run was validated); the compile rules come from the
 * project, falling back to the kit's defaults.
 */
export function buildCompileSetup(kitRow: CompileKitRow, project: { plate_layout: unknown; compile_rules: unknown }): CompileSetup {
  const rows = (kitRow.kit_targets ?? []).map((t) => ({ ...t, std_slope: num(t.std_slope) }))
  const base = buildValidationSetup({ ...kitRow, kit_targets: rows }, { plate_layout: project.plate_layout, qc_rules: null })
  const notes = [...base.notes]

  const parsed = project.compile_rules ? parseRuleSettings(project.compile_rules, base.panel, "compile", "compile") : null
  if (parsed && !parsed.ok) notes.push("The project's compilation settings were invalid, so the kit defaults were used.")
  const rules = parsed?.ok ? parsed.data : defaultRuleSettings(base.panel, "compile")

  const targets = new Map(
    (kitRow.kit_targets ?? []).map((t) => [
      t.target_name,
      { id: t.id, stdSlope: num(t.std_slope), stdIntercept: num(t.std_intercept) },
    ])
  )
  return { kit: base.kit, layout: base.layout, rules, targets, notes }
}

export async function loadCompileSetup(
  supabase: SupabaseClient,
  project: { kit_id: string; plate_layout: unknown; compile_rules: unknown }
): Promise<CompileSetup> {
  const { data, error } = await supabase.from("kits").select(COMPILE_KIT_SELECT).eq("id", project.kit_id).maybeSingle()
  if (error) throw new Error(`Could not load the project's kit: ${error.message}`)
  if (!data) throw new Error("The project's kit could not be found.")
  return buildCompileSetup(data as CompileKitRow, project)
}
