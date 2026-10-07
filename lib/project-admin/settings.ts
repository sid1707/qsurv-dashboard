import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { parseDisplayDateToYmd } from "@/lib/format"
import { KIT_SELECT, summariseKits, type KitRow, type KitSummary } from "@/lib/kits/public"
import { FREQUENCIES } from "@/lib/onboarding/schema"
import { DEFAULT_COUNTS, countsFit, presetLayout, type PlateLayout } from "@/lib/plate/layout"
import { dbErrorMessage } from "@/lib/project-admin/result"
import { defaultRuleSettings } from "@/lib/rules/catalog"

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`)

const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || parseDisplayDateToYmd(v) !== null, `${label} must be a date like 31/12/2026.`)
    .transform((v) => (v ? parseDisplayDateToYmd(v) : null))

export const detailsInput = z
  .object({
    title: z.string().trim().min(1, "Enter the project title.").max(200, "The title must be 200 characters or fewer."),
    objective: optionalText(4000, "The objective"),
    fundingAgency: optionalText(200, "The funding agency"),
    ethicsReference: optionalText(200, "The ethics reference"),
    startDate: optionalDate("Start date"),
    endDate: optionalDate("End date"),
    frequency: z.enum(FREQUENCIES.map((f) => f.value) as [string, ...string[]], { error: "Choose the sampling frequency." }),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    path: ["endDate"],
    message: "The end date must be on or after the start date.",
  })

export type DetailsInput = z.output<typeof detailsInput>
type Result = { ok: true } | { ok: false; message: string }

export function parseDetailsForm(formData: FormData) {
  const get = (key: string) => formData.get(key) ?? ""
  return detailsInput.safeParse({
    title: get("title"),
    objective: get("objective"),
    fundingAgency: get("fundingAgency"),
    ethicsReference: get("ethicsReference"),
    startDate: get("startDate"),
    endDate: get("endDate"),
    frequency: get("frequency"),
  })
}

export async function updateProjectDetails(supabase: SupabaseClient, projectId: string, input: DetailsInput): Promise<Result> {
  const { error } = await supabase.rpc("update_project_details", {
    p_project_id: projectId,
    p_details: {
      title: input.title,
      objective: input.objective,
      funding_agency: input.fundingAgency,
      ethics_reference: input.ethicsReference,
      start_date: input.startDate ?? "",
      end_date: input.endDate ?? "",
      frequency: input.frequency,
    },
  })
  return error ? { ok: false, message: dbErrorMessage(error) } : { ok: true }
}

/** The kit is fixed once any upload batch exists, even a draft. */
export async function projectHasData(supabase: SupabaseClient, projectId: string) {
  const { count, error } = await supabase
    .from("upload_batches")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
  if (error) throw new Error(`Could not check for uploads: ${error.message}`)
  return (count ?? 0) > 0
}

export async function loadKit(supabase: SupabaseClient, kitId: string): Promise<KitSummary | null> {
  const { data, error } = await supabase.from("kits").select(KIT_SELECT).eq("id", kitId).maybeSingle()
  if (error) throw new Error(`Could not load the kit: ${error.message}`)
  return data ? summariseKits([data as KitRow])[0] : null
}

/**
 * The layout and rules that go with a new kit: the preset layout (keeping the
 * current replicate and control counts when they still fit) and the kit's
 * default rules. The admin can fine-tune them later; a layout drawn for the old
 * kit's tubes would not be valid for the new one.
 */
export function kitChangeDefaults(kit: KitSummary, current: PlateLayout | null) {
  // One sample per plate: centres choose the samples per plate on each upload.
  const base = current?.counts && { unknownReplicates: current.counts.unknownReplicates, pc: current.counts.pc, nc: current.counts.nc }
  const counts = base && countsFit(kit, base) ? base : DEFAULT_COUNTS
  return {
    plateLayout: presetLayout(kit, counts),
    qcRules: defaultRuleSettings(kit, "qc"),
    compileRules: defaultRuleSettings(kit, "compile"),
  }
}

export async function changeProjectKit(
  supabase: SupabaseClient,
  project: { id: string; kit_id: string; plate_layout: PlateLayout | null },
  kitId: unknown
): Promise<Result> {
  if (!z.uuid().safeParse(kitId).success) return { ok: false, message: "Choose a kit." }
  if (kitId === project.kit_id) return { ok: false, message: "This project already uses that kit." }
  const kit = await loadKit(supabase, kitId as string)
  if (!kit) return { ok: false, message: "Choose an available kit." }

  const defaults = kitChangeDefaults(kit, project.plate_layout)
  const { error } = await supabase.rpc("change_project_kit", {
    p_project_id: project.id,
    p_kit_id: kit.id,
    p_plate_layout: defaults.plateLayout,
    p_qc_rules: defaults.qcRules,
    p_compile_rules: defaults.compileRules,
  })
  return error ? { ok: false, message: dbErrorMessage(error) } : { ok: true }
}
