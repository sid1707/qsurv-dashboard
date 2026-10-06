import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { CENTRE_ID_HINT, CENTRE_ID_PATTERN, normaliseCentreId } from "@/lib/centres/file-name"
import { dbErrorMessage } from "@/lib/project-admin/result"

export type CentreRow = {
  id: string
  name: string
  city: string | null
  state: string | null
  contact_email: string | null
  active: boolean
  users: number
  /** Centre ID given by the admin (first part of file names), or null until set. */
  code: string | null
  /** Name_Location part of file names; fixed once the centre uploads. */
  file_code: string
}

/** Centre ID field: optional here, uppercased, no spaces or underscores. */
export const centreIdField = z
  .string()
  .trim()
  .transform(normaliseCentreId)
  .refine((v) => v === "" || CENTRE_ID_PATTERN.test(v), `Centre ID: ${CENTRE_ID_HINT}`)
  .transform((v) => v || null)

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => v || null)

export const centreInput = z.object({
  name: z.string().trim().min(1, "Enter the centre name.").max(120, "The name must be 120 characters or fewer."),
  // The location is part of every file name the centre uploads.
  city: z.string().trim().min(1, "Enter the city: it is part of the centre's file names.").max(80, "City must be 80 characters or fewer."),
  code: centreIdField,
  state: optionalText(80, "State"),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email or leave it blank.")
    .transform((v) => v || null),
})

export type CentreInput = z.output<typeof centreInput>
type Result = { ok: true; id: string; name: string } | { ok: false; message: string }

const DUPLICATE = "A centre with this name already exists in this project."
const DUPLICATE_ID = "Another centre in this project already has that centre ID."

/** Unique violations name their index; tell the admin which value clashed. */
function centreError(error: { code?: string; message: string }) {
  return dbErrorMessage(error, error.message.includes("idx_centres_project_code") ? DUPLICATE_ID : DUPLICATE)
}

export function parseCentreForm(formData: FormData) {
  return centreInput.safeParse({
    name: formData.get("name") ?? "",
    city: formData.get("city") ?? "",
    code: formData.get("code") ?? "",
    state: formData.get("state") ?? "",
    contactEmail: formData.get("contactEmail") ?? "",
  })
}

export async function listCentres(supabase: SupabaseClient, projectId: string): Promise<CentreRow[]> {
  const { data, error } = await supabase
    .from("centres")
    .select("id, name, city, state, contact_email, active, code, file_code, project_memberships(count)")
    .eq("project_id", projectId)
    .order("active", { ascending: false })
    .order("name")
  if (error) throw new Error(`Could not load centres: ${error.message}`)
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    state: c.state,
    contact_email: c.contact_email,
    active: c.active,
    code: c.code,
    file_code: c.file_code,
    users: (c.project_memberships as { count: number }[] | null)?.[0]?.count ?? 0,
  }))
}

export async function createCentre(supabase: SupabaseClient, projectId: string, input: CentreInput): Promise<Result> {
  const { data, error } = await supabase
    .from("centres")
    .insert({
      project_id: projectId,
      name: input.name,
      city: input.city,
      code: input.code,
      state: input.state,
      contact_email: input.contactEmail,
    })
    .select("id, name")
    .single()
  if (error) return { ok: false, message: centreError(error) }
  return { ok: true, id: data.id, name: data.name }
}

export async function updateCentre(
  supabase: SupabaseClient,
  projectId: string,
  centreId: string,
  input: CentreInput
): Promise<Result> {
  if (!z.uuid().safeParse(centreId).success) return { ok: false, message: "Invalid centre." }
  const { data, error } = await supabase
    .from("centres")
    .update({ name: input.name, city: input.city, code: input.code, state: input.state, contact_email: input.contactEmail })
    .eq("id", centreId)
    .eq("project_id", projectId)
    .select("id, name")
    .maybeSingle()
  if (error) return { ok: false, message: centreError(error) }
  if (!data) return { ok: false, message: "Centre not found in this project." }
  return { ok: true, id: data.id, name: data.name }
}

/**
 * Deactivated centres keep their users and data but drop out of announcement
 * audiences and new invites. Centres are never deleted, because uploads cascade.
 */
export async function setCentreActive(
  supabase: SupabaseClient,
  projectId: string,
  centreId: string,
  active: boolean
): Promise<Result> {
  if (!z.uuid().safeParse(centreId).success) return { ok: false, message: "Invalid centre." }
  const { data, error } = await supabase
    .from("centres")
    .update({ active })
    .eq("id", centreId)
    .eq("project_id", projectId)
    .select("id, name")
    .maybeSingle()
  if (error) return { ok: false, message: dbErrorMessage(error) }
  if (!data) return { ok: false, message: "Centre not found in this project." }
  return { ok: true, id: data.id, name: data.name }
}

/**
 * Gives a centre its ID, as the admin does when adding its first users. Only
 * sets an ID that is missing; changing one goes through the Centres page.
 */
export async function assignCentreId(
  supabase: SupabaseClient,
  projectId: string,
  centreId: string,
  rawCode: unknown
): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  const parsed = centreIdField.safeParse(rawCode ?? "")
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }
  if (!parsed.data) return { ok: false, message: "Give the centre its centre ID. File names start with it." }
  const { data, error } = await supabase
    .from("centres")
    .update({ code: parsed.data })
    .eq("id", centreId)
    .eq("project_id", projectId)
    .is("code", null)
    .select("code")
    .maybeSingle()
  if (error) return { ok: false, message: centreError(error) }
  if (!data) return { ok: false, message: "That centre already has a centre ID." }
  return { ok: true, code: data.code }
}
