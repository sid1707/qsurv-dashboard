import { z } from "zod"
import { PLATE_COLUMNS, PLATE_ROWS, WELL_PATTERN } from "@/lib/plate/layout"

export { PLATE_COLUMNS, PLATE_ROWS }

// Matches the public.kit_control_type enum.
export const CONTROL_TYPES = [
  { value: "none", label: "Target (not a control)" },
  { value: "exogenous_control", label: "Exogenous internal control (e.g. MS-2)" },
  { value: "endogenous_control", label: "Endogenous control (e.g. Enterobacter, PMMoV)" },
  { value: "internal_control", label: "Internal control (unspecified)" },
  { value: "positive_control", label: "Positive control" },
  { value: "negative_control", label: "Negative control" },
  { value: "ntc", label: "No-template control (NTC)" },
] as const

export const LAYOUT_ORIENTATIONS = [
  { value: "tubes_in_rows", label: "One tube per row (samples across columns)" },
  { value: "tubes_in_columns", label: "One tube per column (samples down rows)" },
] as const

/** Splits "A1, a2  B3" into ["A1", "A2", "B3"], uppercased and de-duplicated. */
export function parseList(value: string, { upper = false } = {}) {
  const items = value
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (upper ? v.toUpperCase() : v))
  return [...new Set(items)]
}

/** Aliases may contain spaces, so they are comma-separated only. */
export function parseAliases(value: string) {
  return [...new Set(value.split(/[,;]/).map((v) => v.trim()).filter(Boolean))]
}

const optionalCt = z
  .string()
  .trim()
  .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 50), "Ct must be between 0 and 50.")

const optionalNumber = (label: string, check: (n: number) => boolean, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && check(Number(v))), `${label} ${message}`)

const targetRow = z.object({
  id: z.string(),
  targetName: z.string().trim().min(1, "Target name is required.").max(100),
  aliases: z.string().max(500),
  fluorophore: z.string().trim().min(1, "Fluorophore is required.").max(40),
  channel: z.string().trim().max(40),
  wells: z.string().max(1000),
  controlType: z.enum(CONTROL_TYPES.map((c) => c.value) as [string, ...string[]], { error: "Choose a type." }),
  ctMin: optionalCt,
  ctMax: optionalCt,
  tubeName: z.string().trim().min(1, "Tube is required.").max(60),
  tubeOrder: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 96, "Tube order must be a whole number from 1 to 96."),
  stdSlope: optionalNumber("Slope", (n) => n < 0, "must be a negative number."),
  stdIntercept: optionalNumber("Intercept", (n) => n > 0 && n <= 60, "must be between 0 and 60."),
  pcCopies: optionalNumber("PC copies", (n) => n > 0, "must be a positive number."),
})

export type TargetFormRow = z.input<typeof targetRow>

export type KitFormValues = {
  id: string
  name: string
  version: string
  active: boolean
  layoutOrientation: string
  targets: TargetFormRow[]
}

export const kitFormSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1, "Kit name is required.").max(120),
    version: z.string().trim().min(1, "Version is required.").max(40),
    active: z.boolean(),
    layoutOrientation: z.enum(LAYOUT_ORIENTATIONS.map((o) => o.value) as [string, ...string[]], {
      error: "Choose a layout.",
    }),
    targets: z.array(targetRow).min(1, "Add at least one target.").max(96),
  })
  .superRefine((kit, ctx) => {
    if (kit.id && !z.uuid().safeParse(kit.id).success) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "Invalid kit." })
    }
    const names = new Map<string, number>()
    const wellDyes = new Map<string, number>()
    const tubeDyes = new Map<string, number>()
    const tubeOrders = new Map<string, string>()
    kit.targets.forEach((t, i) => {
      if (t.id && !z.uuid().safeParse(t.id).success) {
        ctx.addIssue({ code: "custom", path: ["targets", i, "id"], message: "Invalid target." })
      }
      const name = t.targetName.toLowerCase()
      if (names.has(name)) {
        ctx.addIssue({ code: "custom", path: ["targets", i, "targetName"], message: "Target names must be unique." })
      }
      names.set(name, i)

      // Targets in one tube share a well, so each needs its own dye.
      const tubeKey = `${t.tubeName.toLowerCase()}:${t.fluorophore.toLowerCase()}`
      const dyeClash = tubeDyes.get(tubeKey)
      if (dyeClash !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", i, "fluorophore"],
          message: `${t.tubeName} already reads ${t.fluorophore} for ${kit.targets[dyeClash].targetName}.`,
        })
      } else {
        tubeDyes.set(tubeKey, i)
      }
      const order = tubeOrders.get(t.tubeName.toLowerCase())
      if (order !== undefined && order !== t.tubeOrder) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", i, "tubeOrder"],
          message: `Targets in ${t.tubeName} must share one tube order (${order}).`,
        })
      } else {
        tubeOrders.set(t.tubeName.toLowerCase(), t.tubeOrder)
      }
      if ((t.stdSlope === "") !== (t.stdIntercept === "")) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", i, t.stdSlope === "" ? "stdSlope" : "stdIntercept"],
          message: "Enter both the slope and the intercept, or neither.",
        })
      }

      // Default wells are optional: each project designs its own plate layout.
      const wells = parseList(t.wells, { upper: true })
      const bad = wells.filter((w) => !WELL_PATTERN.test(w))
      if (bad.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", i, "wells"],
          message: `Not a 96-well position: ${bad.join(", ")}. Use A1 to H12.`,
        })
      }
      // Two targets read with the same dye in the same well cannot be told apart.
      for (const well of wells.filter((w) => WELL_PATTERN.test(w))) {
        const key = `${well}:${t.fluorophore.toLowerCase()}`
        const clash = wellDyes.get(key)
        if (clash !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["targets", i, "wells"],
            message: `${well} already reads ${t.fluorophore} for ${kit.targets[clash].targetName}.`,
          })
        } else {
          wellDyes.set(key, i)
        }
      }

      if (t.ctMin !== "" && t.ctMax !== "" && Number(t.ctMin) > Number(t.ctMax)) {
        ctx.addIssue({ code: "custom", path: ["targets", i, "ctMax"], message: "Max Ct must be at least min Ct." })
      }
    })
  })

export type FieldErrors = Record<string, string>

export function validateKitForm(values: unknown) {
  const result = kitFormSchema.safeParse(values)
  if (result.success) return { ok: true as const, data: result.data, errors: {} as FieldErrors }
  const errors: FieldErrors = {}
  for (const issue of result.error.issues) errors[issue.path.join(".") || "form"] ??= issue.message
  return { ok: false as const, errors }
}

/** Arguments for public.save_kit. Sort order follows the row order in the editor. */
export function toSaveKitArgs(kit: z.output<typeof kitFormSchema>) {
  return {
    p_kit: {
      id: kit.id || null,
      name: kit.name,
      version: kit.version,
      active: kit.active,
      layout_orientation: kit.layoutOrientation,
    },
    p_targets: kit.targets.map((t, i) => ({
      id: t.id || null,
      target_name: t.targetName,
      aliases: parseAliases(t.aliases),
      fluorophore: t.fluorophore,
      channel: t.channel || null,
      plate_wells: parseList(t.wells, { upper: true }),
      control_type: t.controlType,
      ct_min: t.ctMin === "" ? null : Number(t.ctMin),
      ct_max: t.ctMax === "" ? null : Number(t.ctMax),
      sort_order: i + 1,
      tube_name: t.tubeName,
      tube_order: Number(t.tubeOrder),
      std_slope: t.stdSlope === "" ? null : Number(t.stdSlope),
      std_intercept: t.stdIntercept === "" ? null : Number(t.stdIntercept),
      pc_copies: t.pcCopies === "" ? null : Number(t.pcCopies),
    })),
  }
}

export const EMPTY_TARGET: TargetFormRow = {
  id: "",
  targetName: "",
  aliases: "",
  fluorophore: "",
  channel: "",
  wells: "",
  controlType: "none",
  ctMin: "",
  ctMax: "",
  tubeName: "Tube 1",
  tubeOrder: "1",
  stdSlope: "",
  stdIntercept: "",
  pcCopies: "",
}
