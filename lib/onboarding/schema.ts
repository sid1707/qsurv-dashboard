import { z } from "zod"
import type { KitPanel } from "@/lib/kits/public"
import { parseLayout, samplesPerPlate, type PlateLayout } from "@/lib/plate/layout"
import { parseRuleSettings, type RuleSettings } from "@/lib/rules/catalog"

// Option lists for the onboarding form. Keys match the check constraints in
// supabase/migrations/20261001120000_onboarding_form_fields.sql.
export const SAMPLE_TYPES = [
  { value: "wastewater", label: "Wastewater" },
  { value: "clinical", label: "Clinical" },
  { value: "environmental", label: "Environmental" },
  { value: "other", label: "Other" },
] as const

export const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
] as const

export const INSTRUMENTS = [
  { value: "quantstudio_5", label: "QuantStudio 5" },
  { value: "biorad_cfx96", label: "Bio-Rad CFX96" },
  { value: "other", label: "Other" },
] as const

export const USER_TIERS = [
  { value: "under_20", label: "Fewer than 20" },
  { value: "20_to_50", label: "20 to 50" },
  { value: "50_to_100", label: "50 to 100" },
  { value: "over_100", label: "More than 100" },
] as const

type OptionValues<T extends readonly { value: string }[]> = [T[number]["value"], ...T[number]["value"][]]
const values = <T extends readonly { value: string }[]>(options: T) =>
  options.map((o) => o.value) as OptionValues<T>

export const MAX_PROPOSED_CENTRES = 200
export const SHORT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/

const text = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`)

const optionalText = (label: string, max = 200) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`)

/** Optional ISO date: empty becomes null. */
const optionalIsoDate = (label: string) =>
  z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))),
      `${label} must be a valid date.`
    )
    .transform((v) => (v === "" ? null : v))

export const shortCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Short code must be at least 2 characters.")
  .max(32, "Short code must be 32 characters or fewer.")
  .regex(
    SHORT_CODE_PATTERN,
    "Use capital letters, numbers and hyphens only, starting with a letter or number."
  )

// ---------- Step 1: admin account ----------
export const accountStep = z
  .object({
    fullName: text("Full name", 120),
    designation: text("Designation", 120),
    email: z.string().trim().toLowerCase().min(1, "Email is required.").pipe(z.email("Enter a valid email address.")),
    password: z
      .string()
      .min(10, "Password must be at least 10 characters.")
      .max(72, "Password must be 72 characters or fewer."),
    confirmPassword: z.string().min(1, "Confirm your password."),
    phone: z
      .string()
      .trim()
      .min(1, "Phone is required.")
      .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number."),
  })
  .superRefine((v, ctx) => {
    if (v.confirmPassword && v.password !== v.confirmPassword) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match." })
    }
  })

// ---------- Step 2: organisation ----------
export const organisationStep = z.object({
  institutionName: text("Nodal lab or institute name"),
  city: text("City", 100),
  state: text("State", 100),
})

// ---------- Step 3: project ----------
export const projectStep = z
  .object({
    projectTitle: text("Project title"),
    shortCode: shortCodeSchema,
    objective: text("Objective", 2000),
    fundingAgency: optionalText("Funding agency"),
    startDate: optionalIsoDate("Start date"),
    endDate: optionalIsoDate("End date"),
    sampleType: z.enum(values(SAMPLE_TYPES), { error: "Choose a sample type." }),
    sampleTypeOther: optionalText("Sample type", 100),
    frequency: z.enum(values(FREQUENCIES), { error: "Choose a sampling frequency." }),
    ethicsReference: optionalText("Ethics approval reference"),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the start date." })
    }
    if (v.sampleType === "other" && !v.sampleTypeOther) {
      ctx.addIssue({ code: "custom", path: ["sampleTypeOther"], message: "Describe the sample type." })
    }
  })

// ---------- Step 4: qPCR setup ----------
const centreRow = z.object({
  name: optionalText("Centre name", 200),
  city: optionalText("City", 100),
  contactEmail: z.string().trim().toLowerCase(),
})

export const qpcrStep = z
  .object({
    kitId: z.string().min(1, "Choose a kit.").pipe(z.uuid("Choose a kit.")),
    instruments: z
      .array(z.enum(values(INSTRUMENTS)), { error: "Choose at least one qPCR instrument." })
      .min(1, "Choose at least one qPCR instrument.")
      .transform((list) => INSTRUMENTS.map((o) => o.value).filter((v) => list.includes(v))),
    instrumentOther: optionalText("Instrument", 100),
    centres: z.array(centreRow).max(MAX_PROPOSED_CENTRES, `List ${MAX_PROPOSED_CENTRES} or fewer centres.`),
    userTier: z.enum(values(USER_TIERS), { error: "Choose the number of users." }),
  })
  .superRefine((v, ctx) => {
    if (v.instruments.includes("other") && !v.instrumentOther) {
      ctx.addIssue({ code: "custom", path: ["instrumentOther"], message: "Name the instrument." })
    }
    v.centres.forEach((row, i) => {
      const filled = row.name || row.city || row.contactEmail
      if (!filled) return
      if (!row.name) {
        ctx.addIssue({ code: "custom", path: ["centres", i, "name"], message: "Centre name is required." })
      }
      // The location is part of every file name the centre uploads.
      if (!row.city) {
        ctx.addIssue({ code: "custom", path: ["centres", i, "city"], message: "City is required for the centre's file names." })
      }
      if (row.contactEmail && !z.email().safeParse(row.contactEmail).success) {
        ctx.addIssue({ code: "custom", path: ["centres", i, "contactEmail"], message: "Enter a valid email address." })
      }
    })
  })
  .transform((v) => ({
    ...v,
    // Drop empty rows left in the optional table.
    centres: v.centres.filter((r) => r.name || r.city || r.contactEmail),
  }))

// ---------- Step 5: analysis ----------
export const analysisStep = z
  .object({
    dataManagement: z.boolean(),
    dataCompilation: z.boolean(),
    dataPlotting: z.boolean(),
    consent: z.boolean().refine((v) => v, "You must accept the terms and data-sharing consent."),
  })
  .superRefine((v, ctx) => {
    if (!v.dataManagement && !v.dataCompilation && !v.dataPlotting) {
      ctx.addIssue({ code: "custom", path: ["dataManagement"], message: "Choose at least one analysis." })
    }
  })

// ---------- Steps 5 and 6: plate layout and data rules (checked against the kit) ----------
export type FieldErrors = Record<string, string>

type StepResult = { ok: true; data: Record<string, unknown> } | { ok: false; errors: FieldErrors }
type StepCheck = (values: unknown, kit: KitPanel | null) => StepResult

const NO_KIT: StepResult = { ok: false, errors: { kitId: "Choose a kit first." } }

const field = (values: unknown, key: string) =>
  values && typeof values === "object" ? (values as Record<string, unknown>)[key] : undefined

const checkLayout: StepCheck = (values, kit) => {
  if (!kit) return NO_KIT
  const result = parseLayout(field(values, "plateLayout"), kit)
  if (!result.ok) return { ok: false, errors: { plateLayout: result.errors.join(" ") } }
  // Samples per plate are chosen by centres on each upload, not here.
  if (samplesPerPlate(result.data.counts) > 1) {
    return { ok: false, errors: { plateLayout: "Set up the layout for one sample per plate." } }
  }
  return { ok: true, data: { plateLayout: result.data } }
}

const checkRules: StepCheck = (values, kit) => {
  if (!kit) return NO_KIT
  const qc = parseRuleSettings(field(values, "qcRules"), kit, "qc", "qcRules")
  const compile = parseRuleSettings(field(values, "compileRules"), kit, "compile", "compileRules")
  if (!qc.ok || !compile.ok) {
    return { ok: false, errors: { ...(qc.ok ? {} : qc.errors), ...(compile.ok ? {} : compile.errors) } }
  }
  return { ok: true, data: { qcRules: qc.data, compileRules: compile.data } }
}

function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form"
    errors[key] ??= issue.message
  }
  return errors
}

const fromSchema =
  (schema: z.ZodType<Record<string, unknown>>): StepCheck =>
  (values) => {
    const result = schema.safeParse(values)
    return result.success ? { ok: true, data: result.data } : { ok: false, errors: toFieldErrors(result.error) }
  }

export const ONBOARDING_STEPS: { title: string; check: StepCheck }[] = [
  { title: "Admin account", check: fromSchema(accountStep) },
  { title: "Organisation", check: fromSchema(organisationStep) },
  { title: "Project", check: fromSchema(projectStep) },
  { title: "qPCR setup", check: fromSchema(qpcrStep) },
  { title: "Plate layout", check: checkLayout },
  { title: "Data rules", check: checkRules },
  { title: "Analysis", check: fromSchema(analysisStep) },
]

export const STEP = { account: 0, organisation: 1, project: 2, qpcr: 3, layout: 4, rules: 5, analysis: 6 } as const

/** Raw form values as held by the client (every input is a string or boolean). */
export type OnboardingValues = {
  fullName: string
  designation: string
  email: string
  password: string
  confirmPassword: string
  phone: string
  institutionName: string
  city: string
  state: string
  projectTitle: string
  shortCode: string
  objective: string
  fundingAgency: string
  startDate: string
  endDate: string
  sampleType: string
  sampleTypeOther: string
  frequency: string
  ethicsReference: string
  kitId: string
  instruments: string[]
  instrumentOther: string
  centres: { name: string; city: string; contactEmail: string }[]
  userTier: string
  plateLayout: PlateLayout | null
  qcRules: RuleSettings
  compileRules: RuleSettings
  dataManagement: boolean
  dataCompilation: boolean
  dataPlotting: boolean
  consent: boolean
}

export const EMPTY_ONBOARDING_VALUES: OnboardingValues = {
  fullName: "",
  designation: "",
  email: "",
  password: "",
  confirmPassword: "",
  phone: "",
  institutionName: "",
  city: "",
  state: "",
  projectTitle: "",
  shortCode: "",
  objective: "",
  fundingAgency: "",
  startDate: "",
  endDate: "",
  sampleType: "",
  sampleTypeOther: "",
  frequency: "",
  ethicsReference: "",
  kitId: "",
  instruments: [],
  instrumentOther: "",
  centres: [],
  userTier: "",
  plateLayout: null,
  qcRules: {},
  compileRules: {},
  dataManagement: true,
  dataCompilation: false,
  dataPlotting: false,
  consent: false,
}

/** Validates one step. The layout and rule steps need the selected kit. */
export function validateStep(step: number, values: unknown, kit: KitPanel | null = null) {
  const result = ONBOARDING_STEPS[step].check(values, kit)
  return result.ok ? { ok: true as const, errors: {} as FieldErrors } : { ok: false as const, errors: result.errors }
}

export type OnboardingSubmission = z.output<typeof accountStep> &
  z.output<typeof organisationStep> &
  z.output<typeof projectStep> &
  z.output<typeof qpcrStep> &
  z.output<typeof analysisStep> & {
    plateLayout: PlateLayout
    qcRules: RuleSettings
    compileRules: RuleSettings
  }

/** Validates every step. Returns the first failing step so the UI can jump to it. */
export function parseOnboarding(
  values: unknown,
  kit: KitPanel | null
): { ok: true; data: OnboardingSubmission } | { ok: false; step: number; errors: FieldErrors } {
  const data: Record<string, unknown> = {}
  for (let step = 0; step < ONBOARDING_STEPS.length; step++) {
    const result = ONBOARDING_STEPS[step].check(values, kit)
    if (!result.ok) return { ok: false, step, errors: result.errors }
    Object.assign(data, result.data)
  }
  return { ok: true, data: data as OnboardingSubmission }
}
