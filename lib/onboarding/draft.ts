import { EMPTY_ONBOARDING_VALUES, INSTRUMENTS, ONBOARDING_STEPS, type OnboardingValues } from "@/lib/onboarding/schema"
import { plateLayoutSchema } from "@/lib/plate/layout"
import type { RuleSettings } from "@/lib/rules/catalog"

// v2 added the plate layout and data rules; v1 drafts are ignored.
export const DRAFT_STORAGE_KEY = "qsurv-onboarding-draft-v2"

// Passwords never go into browser storage.
const NEVER_STORED = ["password", "confirmPassword"] as const

export type OnboardingDraft = {
  step: number
  values: OnboardingValues
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function toStoredDraft(draft: OnboardingDraft) {
  const values: Partial<OnboardingValues> = { ...draft.values }
  for (const key of NEVER_STORED) delete values[key]
  return { step: draft.step, values }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Keeps only well-formed rule entries; the rules step re-validates them against the kit. */
function toRuleSettings(value: unknown): RuleSettings {
  if (!isPlainObject(value)) return {}
  const out: RuleSettings = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!isPlainObject(raw) || typeof raw.enabled !== "boolean") continue
    const params: Record<string, number> = {}
    if (isPlainObject(raw.params)) {
      for (const [k, v] of Object.entries(raw.params)) if (typeof v === "number" && Number.isFinite(v)) params[k] = v
    }
    out[id] = { enabled: raw.enabled, params }
    if (isPlainObject(raw.choices)) {
      const choices: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw.choices)) if (typeof v === "string") choices[k] = v
      out[id].choices = choices
    }
  }
  return out
}

const INSTRUMENT_VALUES: string[] = INSTRUMENTS.map((o) => o.value)

export function loadDraft(storage: StorageLike | null = browserStorage()): OnboardingDraft {
  const empty = { step: 0, values: { ...EMPTY_ONBOARDING_VALUES } }
  try {
    const raw = storage?.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as { step?: unknown; values?: Record<string, unknown> }
    const values = { ...EMPTY_ONBOARDING_VALUES }
    // Copy only known keys with the expected type, so a stale or tampered draft cannot break the form.
    for (const key of Object.keys(EMPTY_ONBOARDING_VALUES) as (keyof OnboardingValues)[]) {
      if ((NEVER_STORED as readonly string[]).includes(key)) continue
      const stored = parsed.values?.[key]
      const expected = EMPTY_ONBOARDING_VALUES[key]
      if (key === "plateLayout") {
        const layout = plateLayoutSchema.safeParse(stored)
        values.plateLayout = layout.success ? layout.data : null
      } else if (key === "qcRules" || key === "compileRules") {
        values[key] = toRuleSettings(stored)
      } else if (key === "instruments") {
        if (Array.isArray(stored)) {
          values.instruments = stored.filter((v): v is string => typeof v === "string" && INSTRUMENT_VALUES.includes(v))
        }
      } else if (Array.isArray(expected)) {
        if (Array.isArray(stored)) {
          values.centres = stored
            .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
            .map((r) => ({
              name: String(r.name ?? ""),
              city: String(r.city ?? ""),
              contactEmail: String(r.contactEmail ?? ""),
            }))
        }
      } else if (typeof stored === typeof expected) {
        ;(values as Record<string, unknown>)[key] = stored
      }
    }
    const step =
      typeof parsed.step === "number" && Number.isInteger(parsed.step)
        ? Math.min(Math.max(parsed.step, 0), ONBOARDING_STEPS.length - 1)
        : 0
    return { step, values }
  } catch {
    return empty
  }
}

export function saveDraft(draft: OnboardingDraft, storage: StorageLike | null = browserStorage()) {
  try {
    storage?.setItem(DRAFT_STORAGE_KEY, JSON.stringify(toStoredDraft(draft)))
  } catch {
    // Storage full or blocked: the form still works, the draft just is not kept.
  }
}

export function clearDraft(storage: StorageLike | null = browserStorage()) {
  try {
    storage?.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // Ignore: nothing to clear.
  }
}
