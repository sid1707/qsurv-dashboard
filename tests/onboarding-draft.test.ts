import { describe, expect, it } from "vitest"
import { DRAFT_STORAGE_KEY, clearDraft, loadDraft, saveDraft } from "../lib/onboarding/draft"
import { EMPTY_ONBOARDING_VALUES } from "../lib/onboarding/schema"
import { validValues } from "./onboarding-fixtures"

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe("onboarding draft", () => {
  it("round-trips the form without ever storing passwords", () => {
    const storage = memoryStorage()
    saveDraft({ step: 2, values: validValues() }, storage)

    const raw = storage.data.get(DRAFT_STORAGE_KEY) ?? ""
    expect(raw).not.toContain("correct-horse-battery")
    expect(raw).not.toContain("password")

    const draft = loadDraft(storage)
    expect(draft.step).toBe(2)
    expect(draft.values.password).toBe("")
    expect(draft.values.confirmPassword).toBe("")
    expect(draft.values.projectTitle).toBe("Urban wastewater AMR surveillance")
    expect(draft.values.centres[0].name).toBe("Centre North")
    expect(draft.values.instruments).toEqual(["quantstudio_5"])
    expect(draft.values.plateLayout).toEqual(validValues().plateLayout)
    expect(draft.values.qcRules.ntc_amplification).toEqual({ enabled: true, params: { ct: 37 } })
  })

  it("falls back to an empty form for missing, corrupt or tampered drafts", () => {
    const storage = memoryStorage()
    expect(loadDraft(storage)).toEqual({ step: 0, values: EMPTY_ONBOARDING_VALUES })

    storage.setItem(DRAFT_STORAGE_KEY, "{not json")
    expect(loadDraft(storage).step).toBe(0)

    storage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        step: 99,
        values: {
          consent: "yes",
          fullName: 42,
          password: "leaked",
          centres: "x",
          instruments: ["quantstudio_5", "hacked", 3],
          plateLayout: { version: 1, plates: "nope" },
          qcRules: { ntc_amplification: { enabled: "yes" }, pc_present: { enabled: false, params: { x: "1", y: 2 } } },
        },
      })
    )
    const draft = loadDraft(storage)
    expect(draft.step).toBe(6)
    expect(draft.values.instruments).toEqual(["quantstudio_5"])
    expect(draft.values.plateLayout).toBeNull()
    expect(draft.values.qcRules).toEqual({ pc_present: { enabled: false, params: { y: 2 } } })
    expect(draft.values.consent).toBe(false)
    expect(draft.values.fullName).toBe("")
    expect(draft.values.password).toBe("")
    expect(draft.values.centres).toEqual([])
  })

  it("clears the draft", () => {
    const storage = memoryStorage()
    saveDraft({ step: 1, values: validValues() }, storage)
    clearDraft(storage)
    expect(storage.data.has(DRAFT_STORAGE_KEY)).toBe(false)
  })

  it("does not throw when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
    }
    expect(() => saveDraft({ step: 0, values: validValues() }, broken)).not.toThrow()
    expect(loadDraft(broken).step).toBe(0)
    expect(() => clearDraft(broken)).not.toThrow()
  })
})
