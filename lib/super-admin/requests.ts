import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { KIT_SELECT, summariseKits, type KitRow, type KitSummary } from "@/lib/kits/public"
import type { PlateLayout } from "@/lib/plate/layout"
import type { RuleSettings } from "@/lib/rules/catalog"

export const REQUEST_STATUSES = ["pending", "approved", "rejected"] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export type RequestListItem = {
  id: string
  reference: string
  project_title: string
  requested_code: string | null
  institution_name: string
  city: string | null
  state: string | null
  requester_name: string
  requester_email: string
  expected_centre_count: number | null
  status: RequestStatus
  created_at: string
  reviewed_at: string | null
}

export type ProposedCentre = { name: string; city: string | null; contact_email: string | null }

export type RequestDetail = RequestListItem & {
  requester_user_id: string | null
  requester_phone: string | null
  requester_designation: string | null
  objective: string
  funding_agency: string | null
  start_date: string | null
  end_date: string | null
  sample_type: string
  sample_type_other: string | null
  frequency: string
  ethics_reference: string | null
  kit_id: string | null
  /** The kit with its panel, so the layout and target table can be shown. */
  kit: KitSummary | null
  instrument: string | null
  instruments: string[] | null
  instrument_other: string | null
  user_tier: string | null
  data_management: boolean
  data_compilation: boolean
  data_plotting: boolean
  proposed_centres: ProposedCentre[]
  consent_accepted_at: string | null
  review_note: string | null
  plate_layout: PlateLayout | null
  qc_rules: RuleSettings | null
  compile_rules: RuleSettings | null
}

const LIST_COLUMNS =
  "id, reference, project_title, requested_code, institution_name, city, state, requester_name, requester_email, expected_centre_count, status, created_at, reviewed_at"

export function parseStatus(value: unknown): RequestStatus {
  return REQUEST_STATUSES.includes(value as RequestStatus) ? (value as RequestStatus) : "pending"
}

export async function listRequests(supabase: SupabaseClient, status: RequestStatus) {
  const { data, error } = await supabase
    .from("project_requests")
    .select(LIST_COLUMNS)
    .eq("status", status)
    // Oldest pending first (a queue); most recently reviewed first otherwise.
    .order(status === "pending" ? "created_at" : "reviewed_at", { ascending: status === "pending" })
    .limit(200)
  if (error) throw new Error(`Could not load project requests: ${error.message}`)
  return (data ?? []) as RequestListItem[]
}

export async function countPendingRequests(supabase: SupabaseClient) {
  const { count } = await supabase
    .from("project_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
  return count ?? 0
}

export async function getRequest(supabase: SupabaseClient, id: string): Promise<RequestDetail | null> {
  if (!z.uuid().safeParse(id).success) return null
  const { data, error } = await supabase
    .from("project_requests")
    .select(`${LIST_COLUMNS}, requester_user_id, requester_phone, requester_designation, objective,
      funding_agency, start_date, end_date, sample_type, sample_type_other, frequency, ethics_reference,
      kit_id, kit:kits(${KIT_SELECT}), instrument, instruments, instrument_other, user_tier, data_management,
      data_compilation, data_plotting, proposed_centres, consent_accepted_at, review_note, plate_layout,
      qc_rules, compile_rules`)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`Could not load the project request: ${error.message}`)
  if (!data) return null
  const kitRow = (Array.isArray(data.kit) ? (data.kit[0] ?? null) : data.kit) as KitRow | null
  return { ...data, kit: kitRow ? summariseKits([kitRow])[0] : null } as RequestDetail
}

// ---------- Approve / reject ----------

export type ReviewState = { status: "idle" | "error"; message?: string }

const approveInput = z.object({
  requestId: z.uuid("Invalid request."),
  note: z.string().trim().max(2000, "The note must be 2000 characters or fewer.").optional(),
})

const rejectInput = z.object({
  requestId: z.uuid("Invalid request."),
  reason: z
    .string({ error: "A reason is required to reject a request." })
    .trim()
    .min(1, "A reason is required to reject a request.")
    .max(2000, "The reason must be 2000 characters or fewer."),
})

type RpcError = { code?: string; message: string }

/** Turns errors raised by the review functions into messages for the super admin. */
export function reviewErrorMessage(error: RpcError) {
  switch (error.code) {
    case "42501":
      return "Only a super admin can review project requests."
    case "23505":
      return error.message.includes("short code")
        ? error.message
        : "The short code or a centre name is already in use. Ask the requester for a different code."
    case "P0001":
    case "P0002":
    case "22023":
      return error.message
    default:
      return `The review could not be saved: ${error.message}`
  }
}

export type ApproveResult =
  | { ok: true; projectCode: string; reference: string; centresCreated: number }
  | { ok: false; message: string }

export async function approveRequest(supabase: SupabaseClient, input: unknown): Promise<ApproveResult> {
  const parsed = approveInput.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }

  const { data, error } = await supabase.rpc("approve_project_request", {
    p_request_id: parsed.data.requestId,
    p_note: parsed.data.note || null,
  })
  if (error) return { ok: false, message: reviewErrorMessage(error) }

  const result = data as { project_code: string; reference: string; centres_created: number }
  return {
    ok: true,
    projectCode: result.project_code,
    reference: result.reference,
    centresCreated: result.centres_created,
  }
}

export type RejectResult = { ok: true; reference: string } | { ok: false; message: string }

export async function rejectRequest(supabase: SupabaseClient, input: unknown): Promise<RejectResult> {
  const parsed = rejectInput.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }

  const { data, error } = await supabase.rpc("reject_project_request", {
    p_request_id: parsed.data.requestId,
    p_reason: parsed.data.reason,
  })
  if (error) return { ok: false, message: reviewErrorMessage(error) }
  return { ok: true, reference: (data as { reference: string }).reference }
}
