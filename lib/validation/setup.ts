import type { SupabaseClient } from "@supabase/supabase-js"
import { summariseKits, type KitRow, type KitSummary } from "@/lib/kits/public"
import { DEFAULT_COUNTS, parseLayout, presetLayout, samplesPerPlate, type PlateLayout } from "@/lib/plate/layout"
import { defaultRuleSettings, parseRuleSettings, type RuleSettings } from "@/lib/rules/catalog"
import { buildValidationKit, type KitTargetRow, type ValidationKit } from "./kit"

/** Everything the engine needs to check a run for one project. */
export type ValidationSetup = {
  kit: ValidationKit
  panel: KitSummary
  layout: PlateLayout
  rules: RuleSettings
  /** Set when the stored layout or rules could not be used and defaults stand in. */
  notes: string[]
}

const VALIDATION_KIT_SELECT =
  "id, name, version, layout_orientation, rule_defaults, kit_targets(target_name, aliases, fluorophore, control_type, ct_min, ct_max, sort_order, tube_name, tube_order, std_slope)"

type KitWithTargets = KitRow & { kit_targets: (KitTargetRow & { std_slope: number | null })[] }

/**
 * Builds the setup from the kit row and the project's onboarding choices. The
 * layout falls back to the kit's preset and the rules to the kit's defaults,
 * so older projects still validate.
 */
export function buildValidationSetup(
  kitRow: KitWithTargets,
  project: { plate_layout: unknown; qc_rules: unknown }
): ValidationSetup {
  const panel = summariseKits([kitRow])[0]
  const notes: string[] = []

  const stored = project.plate_layout ? parseLayout(project.plate_layout, panel) : null
  if (stored && !stored.ok) notes.push("The project's plate layout does not fit its kit, so the kit's preset layout was used.")
  let layout = stored?.ok ? stored.data : presetLayout(panel, DEFAULT_COUNTS)
  // The layout holds one sample; samples per plate are chosen on each upload.
  // An older layout drawn for several samples becomes the preset for one.
  if (samplesPerPlate(layout.counts) > 1) {
    const { unknownReplicates, pc, nc } = layout.counts
    layout = presetLayout(panel, { unknownReplicates, pc, nc })
  }

  const parsedRules = project.qc_rules ? parseRuleSettings(project.qc_rules, panel, "qc", "qc") : null
  if (parsedRules && !parsedRules.ok) notes.push("The project's quality-check settings were invalid, so the kit defaults were used.")
  const rules = parsedRules?.ok ? parsedRules.data : defaultRuleSettings(panel, "qc")

  return { kit: buildValidationKit(kitRow.name, kitRow.kit_targets ?? []), panel, layout, rules, notes }
}

export async function loadValidationSetup(
  supabase: SupabaseClient,
  project: { kit_id: string; plate_layout: unknown; qc_rules: unknown }
): Promise<ValidationSetup> {
  const { data, error } = await supabase.from("kits").select(VALIDATION_KIT_SELECT).eq("id", project.kit_id).maybeSingle()
  if (error) throw new Error(`Could not load the project's kit: ${error.message}`)
  if (!data) throw new Error("The project's kit could not be found.")
  return buildValidationSetup(data as KitWithTargets, project)
}
