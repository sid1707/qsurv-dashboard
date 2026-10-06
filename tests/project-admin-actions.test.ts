import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeSupabase } from "./fake-supabase"

const PROJECT_ID = "10000000-0000-4000-8000-000000000001"
const OTHER_PROJECT_ID = "10000000-0000-4000-8000-000000000002"

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  client: null as unknown,
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/projects/context", () => ({ getProjectAdminContext: mocks.context }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }))
vi.mock("@/lib/project-admin/invite-admin", () => ({ createInviteAdmin: () => null }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

import {
  createCentreAction,
  removeUserAction,
  setAnnouncementArchivedAction,
  setCentreActiveAction,
} from "../app/(app)/p/[code]/admin/actions"

const idle = { status: "idle" as const }

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

function adminContext(userId = "admin-user") {
  return {
    user: { userId, isSuperAdmin: false, projects: [] },
    project: { id: PROJECT_ID, code: "RBL-AMR", user_tier: "under_20" },
    features: {},
    membership: { role: "project_admin" },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("project admin actions", () => {
  it("refuse anyone who is not an admin of the project, without touching the database", async () => {
    mocks.context.mockResolvedValue(null)
    const fake = fakeSupabase()
    mocks.client = fake.client

    const message = "Only a project admin of this project can do this."
    expect(await createCentreAction("RBL-AMR", idle, form({ name: "X" }))).toEqual({ status: "error", message })
    expect(await setCentreActiveAction("RBL-AMR", "c", false)).toEqual({ status: "error", message })
    expect(await removeUserAction("RBL-AMR", "m")).toEqual({ status: "error", message })
    expect(await setAnnouncementArchivedAction("RBL-AMR", "a", true)).toEqual({ status: "error", message })
    expect(fake.calls).toEqual([])
  })

  it("use the project from the database, never from the form, and record an audit event", async () => {
    mocks.context.mockResolvedValue(adminContext())
    const fake = fakeSupabase({ "centres.insert": { data: { id: "new-centre", name: "AIIMS" } } })
    mocks.client = fake.client

    const result = await createCentreAction("RBL-AMR", idle, form({ name: "AIIMS", city: "Delhi", projectId: OTHER_PROJECT_ID }))
    expect(result).toEqual({ status: "success", message: "AIIMS added." })
    const insert = fake.calls.find((c) => c.table === "centres")
    expect(insert?.args[0]).toMatchObject({ project_id: PROJECT_ID })
    const audit = fake.calls.find((c) => c.table === "audit_events")
    expect(audit?.args[0]).toMatchObject({
      project_id: PROJECT_ID,
      actor_user_id: "admin-user",
      actor_role: "project_admin",
      event_type: "centre.created",
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/p/RBL-AMR/admin", "layout")
  })

  it("send an admin who removed themselves back to their project list", async () => {
    mocks.context.mockResolvedValue(adminContext("me"))
    mocks.client = fakeSupabase({ "project_memberships.delete": { data: { user_id: "me" } } }).client
    await expect(removeUserAction("RBL-AMR", "30000000-0000-4000-8000-000000000001")).rejects.toThrow("REDIRECT:/projects")
  })
})
