import { FREQUENCIES, INSTRUMENTS, SAMPLE_TYPES, USER_TIERS } from "@/lib/onboarding/schema"

type Options = readonly { value: string; label: string }[]

function label(options: Options, value: string | null | undefined, other?: string | null) {
  if (!value) return "—"
  if (value === "other" && other) return `Other: ${other}`
  return options.find((o) => o.value === value)?.label ?? value
}

export const sampleTypeLabel = (value: string | null, other?: string | null) => label(SAMPLE_TYPES, value, other)
export const frequencyLabel = (value: string | null) => label(FREQUENCIES, value)
export const instrumentLabel = (value: string | null, other?: string | null) => label(INSTRUMENTS, value, other)
/** "QuantStudio 5, Other: LightCycler 480". Falls back to the single legacy instrument column. */
export function instrumentsLabel(values: string[] | null, other?: string | null, legacy?: string | null) {
  const list = values && values.length > 0 ? values : legacy ? [legacy] : []
  if (list.length === 0) return "—"
  return list.map((v) => instrumentLabel(v, other)).join(", ")
}
export const userTierLabel = (value: string | null) => label(USER_TIERS, value)
