import { randomBytes } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { KIT_SELECT, summariseKits, type KitRow, type KitSummary } from "@/lib/kits/public"
import {
  STEP,
  parseOnboarding,
  shortCodeSchema,
  type FieldErrors,
  type OnboardingSubmission,
} from "@/lib/onboarding/schema"
import { consumeRateLimit } from "@/lib/security/rate-limit"

// Accounts stay banned until a super admin approves the request (ban_duration "none" lifts it).
export const PENDING_APPROVAL_BAN = "876000h"

export const SUBMIT_LIMIT = { bucket: "onboarding-submit", limit: 5, windowSeconds: 60 * 60 }
export const SHORT_CODE_LIMIT = { bucket: "onboarding-short-code", limit: 30, windowSeconds: 60 }

export type SubmitResult =
  | { ok: true; reference: string }
  | { ok: false; message: string; step?: number; errors?: FieldErrors }

type Deps = {
  service: SupabaseClient | null
  clientKeyHash: string
}

const UNAVAILABLE = "Project requests are not available right now. Please try again later."

function fakeReference() {
  return `QS-${randomBytes(4).toString("hex").toUpperCase()}`
}

export async function isShortCodeTaken(service: SupabaseClient, code: string) {
  const [projects, requests] = await Promise.all([
    service.from("projects").select("id").eq("code", code).limit(1),
    service
      .from("project_requests")
      .select("id")
      .eq("requested_code", code)
      .neq("status", "rejected")
      .limit(1),
  ])
  if (projects.error) throw new Error(projects.error.message)
  if (requests.error) throw new Error(requests.error.message)
  return (projects.data?.length ?? 0) > 0 || (requests.data?.length ?? 0) > 0
}

export async function checkShortCode(
  input: unknown,
  deps: Deps
): Promise<{ available: boolean; message?: string }> {
  const parsed = shortCodeSchema.safeParse(input)
  if (!parsed.success) return { available: false, message: parsed.error.issues[0].message }
  if (!deps.service) return { available: false, message: UNAVAILABLE }

  const allowed = await consumeRateLimit(deps.service, { ...SHORT_CODE_LIMIT, keyHash: deps.clientKeyHash })
  if (!allowed) return { available: false, message: "Too many checks. Wait a minute and try again." }

  try {
    return (await isShortCodeTaken(deps.service, parsed.data))
      ? { available: false, message: "This short code is already taken." }
      : { available: true }
  } catch {
    return { available: false, message: "Could not check the short code. Try again." }
  }
}

/** Loads an active kit with its panel, or null if it does not exist or is inactive. */
async function loadActiveKit(service: SupabaseClient, kitId: unknown): Promise<KitSummary | null> {
  if (!z.uuid().safeParse(kitId).success) return null
  const { data, error } = await service
    .from("kits")
    .select(KIT_SELECT)
    .eq("id", kitId as string)
    .eq("active", true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? summariseKits([data as KitRow])[0] : null
}

function toRequestRow(data: OnboardingSubmission, userId: string) {
  return {
    requester_user_id: userId,
    requester_name: data.fullName,
    requester_email: data.email,
    requester_phone: data.phone,
    requester_designation: data.designation,
    institution_name: data.institutionName,
    city: data.city,
    state: data.state,
    project_title: data.projectTitle,
    requested_code: data.shortCode,
    objective: data.objective,
    funding_agency: data.fundingAgency || null,
    start_date: data.startDate,
    end_date: data.endDate,
    sample_type: data.sampleType,
    sample_type_other: data.sampleType === "other" ? data.sampleTypeOther : null,
    frequency: data.frequency,
    ethics_reference: data.ethicsReference || null,
    kit_id: data.kitId,
    instruments: data.instruments,
    instrument_other: data.instruments.includes("other") ? data.instrumentOther : null,
    proposed_centres: data.centres.map((c) => ({
      name: c.name,
      city: c.city || null,
      contact_email: c.contactEmail || null,
    })),
    user_tier: data.userTier,
    data_management: data.dataManagement,
    data_compilation: data.dataCompilation,
    data_plotting: data.dataPlotting,
    plate_layout: data.plateLayout,
    qc_rules: data.qcRules,
    compile_rules: data.compileRules,
    consent_accepted_at: new Date().toISOString(),
  }
}

export async function submitOnboarding(input: unknown, deps: Deps): Promise<SubmitResult> {
  const { values, website } = (input ?? {}) as { values?: unknown; website?: unknown }

  // Honeypot: real users never see or fill this field. Pretend success so bots learn nothing.
  if (typeof website === "string" && website.trim() !== "") {
    return { ok: true, reference: fakeReference() }
  }

  if (!deps.service) return { ok: false, message: UNAVAILABLE }
  const service = deps.service

  const allowed = await consumeRateLimit(service, { ...SUBMIT_LIMIT, keyHash: deps.clientKeyHash })
  if (!allowed) {
    return { ok: false, message: "Too many requests from your network. Please try again in an hour." }
  }

  // The layout and rules are checked against the kit as stored, not as the browser saw it.
  let kit: KitSummary | null
  try {
    kit = await loadActiveKit(service, (values as { kitId?: unknown } | undefined)?.kitId)
  } catch {
    return { ok: false, message: UNAVAILABLE }
  }

  const parsed = parseOnboarding(values, kit)
  if (!kit && (parsed.ok || parsed.step > STEP.qpcr)) {
    return { ok: false, message: "Please fix the highlighted fields.", step: STEP.qpcr, errors: { kitId: "Choose a kit." } }
  }
  if (!parsed.ok) {
    return { ok: false, message: "Please fix the highlighted fields.", step: parsed.step, errors: parsed.errors }
  }
  const data = parsed.data

  const codeTaken = { ok: false as const, message: "Please fix the highlighted fields.", step: STEP.project, errors: { shortCode: "This short code is already taken." } }
  try {
    if (await isShortCodeTaken(service, data.shortCode)) return codeTaken
  } catch {
    return { ok: false, message: UNAVAILABLE }
  }

  // The password goes only to Supabase Auth; it is never stored in our tables.
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    ban_duration: PENDING_APPROVAL_BAN,
    user_metadata: { full_name: data.fullName, phone: data.phone },
    app_metadata: { qsurv_status: "pending_approval" },
  })

  if (createError || !created.user) {
    if (createError?.code === "email_exists" || createError?.status === 422) {
      return {
        ok: false,
        message: "Please fix the highlighted fields.",
        step: STEP.account,
        errors: {
          email: "This email already has a QSurv account. Contact the QSurv team to request another project.",
        },
      }
    }
    return { ok: false, message: UNAVAILABLE }
  }

  const userId = created.user.id
  const { data: request, error: insertError } = await service
    .from("project_requests")
    .insert(toRequestRow(data, userId))
    .select("reference")
    .single()

  if (insertError || !request) {
    // Do not leave a blocked account behind for a request that does not exist.
    await service.auth.admin.deleteUser(userId)
    if (insertError?.code === "23505") return codeTaken
    return { ok: false, message: UNAVAILABLE }
  }

  return { ok: true, reference: request.reference as string }
}
