import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  context: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock("@/lib/auth/context", () => ({ requireUserContext: mocks.context }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

import { approveRequestAction, rejectRequestAction } from "../app/(app)/super-admin/actions"
import { approveRequest, rejectRequest, reviewErrorMessage } from "../lib/super-admin/requests"

const REQUEST_ID = "6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d"
const idle = { status: "idle" as const }

function client() {
  return { rpc: mocks.rpc } as unknown as SupabaseClient
}

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ isSuperAdmin: true, projects: [] })
})

describe("approveRequest", () => {
  it("calls the transactional approve function and returns the new project", async () => {
    mocks.rpc.mockResolvedValue({
      data: { project_id: "p1", project_code: "WW-PUNE", reference: "QS-AAAA1111", centres_created: 2 },
      error: null,
    })
    const result = await approveRequest(client(), { requestId: REQUEST_ID, note: "  ok  " })
    expect(mocks.rpc).toHaveBeenCalledWith("approve_project_request", { p_request_id: REQUEST_ID, p_note: "ok" })
    expect(result).toEqual({ ok: true, projectCode: "WW-PUNE", reference: "QS-AAAA1111", centresCreated: 2 })
  })

  it("sends a null note when none is given", async () => {
    mocks.rpc.mockResolvedValue({ data: { project_code: "X", reference: "R", centres_created: 0 }, error: null })
    await approveRequest(client(), { requestId: REQUEST_ID, note: "   " })
    expect(mocks.rpc).toHaveBeenCalledWith("approve_project_request", { p_request_id: REQUEST_ID, p_note: null })
  })

  it("rejects an invalid request id without calling the database", async () => {
    const result = await approveRequest(client(), { requestId: "not-a-uuid" })
    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("passes on the database's explanation when approval fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "The short code WW-PUNE is already used by another project." },
    })
    const result = await approveRequest(client(), { requestId: REQUEST_ID })
    expect(result).toEqual({ ok: false, message: "The short code WW-PUNE is already used by another project." })
  })
})

describe("rejectRequest", () => {
  it.each([undefined, "", "    "])("requires a reason (%o) and does not call the database", async (reason) => {
    const result = await rejectRequest(client(), { requestId: REQUEST_ID, reason })
    expect(result).toEqual({ ok: false, message: "A reason is required to reject a request." })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("calls the reject function with the trimmed reason", async () => {
    mocks.rpc.mockResolvedValue({ data: { reference: "QS-BBBB2222" }, error: null })
    const result = await rejectRequest(client(), { requestId: REQUEST_ID, reason: "  Out of scope " })
    expect(mocks.rpc).toHaveBeenCalledWith("reject_project_request", { p_request_id: REQUEST_ID, p_reason: "Out of scope" })
    expect(result).toEqual({ ok: true, reference: "QS-BBBB2222" })
  })

  it("rejects reasons over 2000 characters", async () => {
    const result = await rejectRequest(client(), { requestId: REQUEST_ID, reason: "x".repeat(2001) })
    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe("reviewErrorMessage", () => {
  it("maps permission errors and passes through the functions' own messages", () => {
    expect(reviewErrorMessage({ code: "42501", message: "x" })).toMatch(/Only a super admin/)
    expect(reviewErrorMessage({ code: "P0001", message: "This request has already been approved." })).toBe(
      "This request has already been approved."
    )
    expect(reviewErrorMessage({ code: "XX000", message: "boom" })).toMatch(/could not be saved: boom/)
  })
})

describe("review server actions", () => {
  it("refuse users who are not super admins, without calling the database", async () => {
    mocks.context.mockResolvedValue({ isSuperAdmin: false, projects: [] })
    const approve = await approveRequestAction(idle, form({ requestId: REQUEST_ID }))
    const reject = await rejectRequestAction(idle, form({ requestId: REQUEST_ID, reason: "no" }))
    expect(approve).toEqual({ status: "error", message: "Only a super admin can do this." })
    expect(reject).toEqual({ status: "error", message: "Only a super admin can do this." })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("approve redirects to the queue with the reference and project", async () => {
    mocks.rpc.mockResolvedValue({
      data: { project_code: "WW-PUNE", reference: "QS-AAAA1111", centres_created: 1 },
      error: null,
    })
    await expect(approveRequestAction(idle, form({ requestId: REQUEST_ID, note: "" }))).rejects.toThrow(
      "REDIRECT:/super-admin?approved=QS-AAAA1111&project=WW-PUNE"
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/super-admin", "layout")
  })

  it("reject without a reason returns an error and stays on the page", async () => {
    const result = await rejectRequestAction(idle, form({ requestId: REQUEST_ID, reason: "" }))
    expect(result).toEqual({ status: "error", message: "A reason is required to reject a request." })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("reject redirects to the queue with the reference", async () => {
    mocks.rpc.mockResolvedValue({ data: { reference: "QS-BBBB2222" }, error: null })
    await expect(
      rejectRequestAction(idle, form({ requestId: REQUEST_ID, reason: "Duplicate request" }))
    ).rejects.toThrow("REDIRECT:/super-admin?rejected=QS-BBBB2222")
  })

  it("approve shows the database error instead of redirecting", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "This request has already been approved." } })
    const result = await approveRequestAction(idle, form({ requestId: REQUEST_ID }))
    expect(result).toEqual({ status: "error", message: "This request has already been approved." })
  })
})
