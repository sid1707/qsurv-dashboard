import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import { PENDING_APPROVAL_BAN, checkShortCode, submitOnboarding } from "../lib/onboarding/submit"
import { KIT_ROW, validValues } from "./onboarding-fixtures"

type Result = { data: unknown; error: { code?: string; message: string } | null }

type FakeOptions = {
  rateLimitOk?: boolean
  kit?: Result
  projects?: Result
  requests?: Result
  insert?: Result
  createUser?: { data: { user: { id: string } | null }; error: { code?: string; status?: number; message: string } | null }
}

/** Chainable stand-in for the bits of the Supabase client submitOnboarding uses. */
function fakeService(options: FakeOptions = {}) {
  const inserts: Record<string, unknown>[] = []
  const createUser = vi.fn(async () => options.createUser ?? { data: { user: { id: "user-1" } }, error: null })
  const deleteUser = vi.fn(async () => ({ data: {}, error: null }))
  const rpc = vi.fn(async () => ({ data: options.rateLimitOk ?? true, error: null }))

  const from = (table: string) => {
    let op: "select" | "insert" = "select"
    const resolve = (): Result => {
      if (op === "insert") return options.insert ?? { data: { reference: "QS-ABCD1234" }, error: null }
      if (table === "kits") return options.kit ?? { data: KIT_ROW, error: null }
      if (table === "projects") return options.projects ?? { data: [], error: null }
      return options.requests ?? { data: [], error: null }
    }
    const builder: Record<string, unknown> = {}
    for (const method of ["select", "eq", "neq", "limit"]) builder[method] = () => builder
    builder.insert = (row: Record<string, unknown>) => {
      op = "insert"
      inserts.push(row)
      return builder
    }
    builder.maybeSingle = async () => resolve()
    builder.single = async () => resolve()
    builder.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected)
    return builder
  }

  const service = { from, rpc, auth: { admin: { createUser, deleteUser } } } as unknown as SupabaseClient
  return { service, inserts, createUser, deleteUser, rpc }
}

const deps = (service: SupabaseClient | null) => ({ service, clientKeyHash: "hash" })

describe("submitOnboarding", () => {
  it("creates a blocked Auth user, inserts the request and returns its reference", async () => {
    const fake = fakeService()
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))

    expect(result).toEqual({ ok: true, reference: "QS-ABCD1234" })
    expect(fake.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "asha.rao@example.org",
        password: "correct-horse-battery",
        ban_duration: PENDING_APPROVAL_BAN,
        user_metadata: { full_name: "Asha Rao", phone: "+91 98765 43210" },
      })
    )
    expect(fake.inserts).toHaveLength(1)
    expect(fake.inserts[0]).toMatchObject({
      requester_user_id: "user-1",
      requested_code: "RBL-AMR",
      instruments: ["quantstudio_5"],
      start_date: "2026-11-01",
      proposed_centres: [{ name: "Centre North", city: "Mysuru", contact_email: "north@example.org" }],
      sample_type_other: null,
      instrument_other: null,
    })
    expect(fake.inserts[0]).not.toHaveProperty("expected_centre_count")
    expect(fake.inserts[0].plate_layout).toMatchObject({ orientation: "tubes_in_rows", counts: { unknownReplicates: 3 } })
    expect(fake.inserts[0].qc_rules).toHaveProperty("ntc_amplification")
    expect(fake.inserts[0].compile_rules).toHaveProperty("outlier_removal")
  })

  it("stores missing project dates as null", async () => {
    const fake = fakeService()
    await submitOnboarding({ values: validValues({ startDate: "", endDate: "" }), website: "" }, deps(fake.service))
    expect(fake.inserts[0]).toMatchObject({ start_date: null, end_date: null })
  })

  it("checks the layout against the kit loaded on the server", async () => {
    const otherKit = { ...KIT_ROW, kit_targets: KIT_ROW.kit_targets!.filter((t) => t.tube_name === "NVK") }
    const fake = fakeService({ kit: { data: otherKit, error: null } })
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    expect(result).toMatchObject({ ok: false, step: 4, errors: { plateLayout: expect.stringMatching(/not in this kit: MTB/) } })
    expect(fake.createUser).not.toHaveBeenCalled()
  })

  it("never puts the password into the project_requests row", async () => {
    const fake = fakeService()
    await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    const row = JSON.stringify(fake.inserts[0])
    expect(row).not.toContain("correct-horse-battery")
    expect(Object.keys(fake.inserts[0]).some((k) => k.toLowerCase().includes("password"))).toBe(false)
  })

  it("silently accepts honeypot submissions without creating anything", async () => {
    const fake = fakeService()
    const result = await submitOnboarding(
      { values: validValues(), website: "http://spam.example" },
      deps(fake.service)
    )
    expect(result.ok).toBe(true)
    expect(fake.createUser).not.toHaveBeenCalled()
    expect(fake.inserts).toHaveLength(0)
  })

  it("rejects callers over the rate limit before doing any work", async () => {
    const fake = fakeService({ rateLimitOk: false })
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Too many requests/) })
    expect(fake.createUser).not.toHaveBeenCalled()
  })

  it("re-validates on the server and points to the failing step", async () => {
    const fake = fakeService()
    const result = await submitOnboarding(
      { values: validValues({ password: "short", confirmPassword: "short" }), website: "" },
      deps(fake.service)
    )
    expect(result).toMatchObject({ ok: false, step: 0, errors: { password: expect.any(String) } })
    expect(fake.createUser).not.toHaveBeenCalled()
  })

  it("rejects an inactive or unknown kit", async () => {
    const fake = fakeService({ kit: { data: null, error: null } })
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    expect(result).toMatchObject({ ok: false, step: 3, errors: { kitId: expect.any(String) } })
  })

  it.each([
    ["an existing project", { projects: { data: [{ id: "p" }], error: null } }],
    ["a pending request", { requests: { data: [{ id: "r" }], error: null } }],
  ])("rejects a short code already used by %s", async (_label, options) => {
    const fake = fakeService(options)
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    expect(result).toMatchObject({ ok: false, step: 2, errors: { shortCode: expect.stringMatching(/taken/) } })
    expect(fake.createUser).not.toHaveBeenCalled()
  })

  it("explains when the email already has an account", async () => {
    const fake = fakeService({
      createUser: { data: { user: null }, error: { code: "email_exists", status: 422, message: "exists" } },
    })
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    expect(result).toMatchObject({ ok: false, step: 0, errors: { email: expect.any(String) } })
  })

  it("deletes the new Auth user if the request cannot be saved", async () => {
    const fake = fakeService({ insert: { data: null, error: { message: "boom" } } })
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    expect(result.ok).toBe(false)
    expect(fake.deleteUser).toHaveBeenCalledWith("user-1")
  })

  it("treats a unique violation on insert as a taken short code (race with another request)", async () => {
    const fake = fakeService({ insert: { data: null, error: { code: "23505", message: "duplicate" } } })
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(fake.service))
    expect(result).toMatchObject({ ok: false, step: 2, errors: { shortCode: expect.any(String) } })
    expect(fake.deleteUser).toHaveBeenCalledWith("user-1")
  })

  it("fails safely when the service role key is not configured", async () => {
    const result = await submitOnboarding({ values: validValues(), website: "" }, deps(null))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/not available/) })
  })
})

describe("checkShortCode", () => {
  it("reports an available code", async () => {
    const fake = fakeService()
    expect(await checkShortCode("rbl-amr", deps(fake.service))).toEqual({ available: true })
  })

  it("reports a taken code", async () => {
    const fake = fakeService({ projects: { data: [{ id: "p" }], error: null } })
    expect(await checkShortCode("RBL-AMR", deps(fake.service))).toMatchObject({ available: false })
  })

  it("validates the format before touching the database", async () => {
    const fake = fakeService()
    expect(await checkShortCode("bad code!", deps(fake.service))).toMatchObject({ available: false })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it("is rate limited", async () => {
    const fake = fakeService({ rateLimitOk: false })
    expect(await checkShortCode("RBL-AMR", deps(fake.service))).toMatchObject({
      available: false,
      message: expect.stringMatching(/Too many/),
    })
  })
})
