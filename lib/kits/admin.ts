import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { toSaveKitArgs, validateKitForm, type FieldErrors, type KitFormValues } from "@/lib/kits/schema"

type Count = { count: number }[] | null

export type KitListItem = {
  id: string
  name: string
  version: string
  active: boolean
  targetCount: number
  projectCount: number
}

const count = (value: Count) => value?.[0]?.count ?? 0

export async function listKitsForAdmin(supabase: SupabaseClient): Promise<KitListItem[]> {
  const { data, error } = await supabase
    .from("kits")
    .select("id, name, version, active, kit_targets(count), projects(count)")
    .order("name")
    .order("version")
  if (error) throw new Error(`Could not load kits: ${error.message}`)
  return (data ?? []).map((k) => ({
    id: k.id,
    name: k.name,
    version: k.version,
    active: k.active,
    targetCount: count(k.kit_targets as Count),
    projectCount: count(k.projects as Count),
  }))
}

type TargetRow = {
  id: string
  target_name: string
  aliases: string[]
  fluorophore: string
  channel: string | null
  plate_wells: string[]
  control_type: string
  ct_min: number | null
  ct_max: number | null
  sort_order: number
  tube_name: string
  tube_order: number
  std_slope: number | null
  std_intercept: number | null
  pc_copies: number | null
}

/** Loads a kit as editor form values, plus how many projects use it. */
export async function getKitForEdit(
  supabase: SupabaseClient,
  id: string
): Promise<{ values: KitFormValues; projectCount: number } | null> {
  if (!z.uuid().safeParse(id).success) return null
  const { data, error } = await supabase
    .from("kits")
    .select(
      "id, name, version, active, layout_orientation, projects(count), kit_targets(id, target_name, aliases, fluorophore, channel, plate_wells, control_type, ct_min, ct_max, sort_order, tube_name, tube_order, std_slope, std_intercept, pc_copies)"
    )
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`Could not load the kit: ${error.message}`)
  if (!data) return null

  const targets = [...((data.kit_targets ?? []) as TargetRow[])].sort((a, b) => a.sort_order - b.sort_order)
  return {
    projectCount: count(data.projects as Count),
    values: {
      id: data.id,
      name: data.name,
      version: data.version,
      active: data.active,
      layoutOrientation: data.layout_orientation,
      targets: targets.map((t) => ({
        id: t.id,
        targetName: t.target_name,
        aliases: t.aliases.join(", "),
        fluorophore: t.fluorophore,
        channel: t.channel ?? "",
        wells: t.plate_wells.join(", "),
        controlType: t.control_type,
        ctMin: t.ct_min === null ? "" : String(t.ct_min),
        ctMax: t.ct_max === null ? "" : String(t.ct_max),
        tubeName: t.tube_name,
        tubeOrder: String(t.tube_order),
        stdSlope: t.std_slope === null ? "" : String(t.std_slope),
        stdIntercept: t.std_intercept === null ? "" : String(t.std_intercept),
        pcCopies: t.pc_copies === null ? "" : String(t.pc_copies),
      })),
    },
  }
}

export type SaveKitResult = { ok: true; kitId: string } | { ok: false; message: string; errors?: FieldErrors }

export async function saveKit(supabase: SupabaseClient, input: unknown): Promise<SaveKitResult> {
  const validation = validateKitForm(input)
  if (!validation.ok) {
    return { ok: false, message: "Please fix the highlighted fields.", errors: validation.errors }
  }

  const { data, error } = await supabase.rpc("save_kit", toSaveKitArgs(validation.data))
  if (error) {
    switch (error.code) {
      case "42501":
        return { ok: false, message: "Only a super admin can edit kits." }
      case "23505":
        return {
          ok: false,
          message:
            "Another kit already has this name and version, two targets share a name, or two targets in one tube share a fluorophore.",
        }
      case "23503":
        return {
          ok: false,
          message:
            "A target you removed is already used in compiled results. Keep it, or create a new kit version instead.",
        }
      default:
        return { ok: false, message: `The kit could not be saved: ${error.message}` }
    }
  }
  return { ok: true, kitId: data as string }
}
