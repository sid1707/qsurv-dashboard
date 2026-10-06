import { describe, expect, it, vi } from "vitest"
import { changeMemberRole, inviteMember, listMembers, removeMember, type InviteAdmin } from "../lib/project-admin/users"
import { seatSummary, userLimit, USER_TIER_LIMITS } from "../lib/project-admin/user-limits"
import { USER_TIERS } from "../lib/onboarding/schema"
import { fakeSupabase } from "./fake-supabase"

const PROJECT = "10000000-0000-4000-8000-000000000001"
const CENTRE = "20000000-0000-4000-8000-000000000001"
const MEMBERSHIP = "30000000-0000-4000-8000-000000000001"
const NEW_USER = "00000000-0000-4000-8000-000000000099"

function inviteAdmin(overrides: Partial<InviteAdmin> = {}): InviteAdmin {
  return {
    findUserIdByEmail: vi.fn(async () => null),
    inviteByEmail: vi.fn(async () => ({ userId: NEW_USER })),
    deleteUser: vi.fn(async () => undefined),
    ...overrides,
  }
}

const centreUser = { email: " New.User@Lab.org ", fullName: "New User", role: "centre_user", centreId: CENTRE }

function deps(admin: InviteAdmin | null, results: Parameters<typeof fakeSupabase>[0] = {}, userTier: string | null = "under_20") {
  const fake = fakeSupabase({
    "centres.select": { data: { id: CENTRE } },
    "project_memberships.select": { count: 3 },
    "project_memberships.insert": { error: null },
    ...results,
  })
  return { fake, deps: { supabase: fake.client, admin, projectId: PROJECT, userTier, redirectTo: "https://x/auth/accept" } }
}

describe("user tier limits", () => {
  it("has a limit for every onboarding tier, matching private.user_tier_limit", () => {
    expect(Object.keys(USER_TIER_LIMITS).sort()).toEqual(USER_TIERS.map((t) => t.value).sort())
    expect(userLimit("under_20")).toBe(20)
    expect(userLimit("over_100")).toBeNull()
    expect(userLimit(null)).toBeNull()
    expect(userLimit("nonsense")).toBeNull()
  })

  it("summarises seats", () => {
    expect(seatSummary(12, "under_20")).toEqual({ used: 12, limit: 20, remaining: 8, full: false })
    expect(seatSummary(20, "under_20")).toEqual({ used: 20, limit: 20, remaining: 0, full: true })
    expect(seatSummary(500, "over_100")).toEqual({ used: 500, limit: null, remaining: null, full: false })
  })
})

describe("inviteMember", () => {
  it("invites a new email and adds the membership with the admin's own client", async () => {
    const admin = inviteAdmin()
    const { fake, deps: d } = deps(admin)
    const result = await inviteMember(d, centreUser)

    expect(result).toEqual({ ok: true, userId: NEW_USER, invited: true, message: "Invite sent to new.user@lab.org." })
    expect(admin.inviteByEmail).toHaveBeenCalledWith("new.user@lab.org", {
      fullName: "New User",
      redirectTo: "https://x/auth/accept",
    })
    const insert = fake.calls.find((c) => c.table === "project_memberships" && c.op === "insert")
    expect(insert?.args[0]).toEqual({ user_id: NEW_USER, project_id: PROJECT, centre_id: CENTRE, role: "centre_user" })
  })

  it("adds an existing account without sending an invite", async () => {
    const admin = inviteAdmin({ findUserIdByEmail: vi.fn(async () => "existing-id") })
    const { deps: d } = deps(admin)
    const result = await inviteMember(d, centreUser)
    expect(result).toMatchObject({ ok: true, userId: "existing-id", invited: false })
    expect(admin.inviteByEmail).not.toHaveBeenCalled()
  })

  it("drops the centre for project admins", async () => {
    const { fake, deps: d } = deps(inviteAdmin())
    await inviteMember(d, { ...centreUser, role: "project_admin" })
    const insert = fake.calls.find((c) => c.table === "project_memberships" && c.op === "insert")
    expect(insert?.args[0]).toMatchObject({ role: "project_admin", centre_id: null })
  })

  it("refuses when the tier limit is reached, before any email goes out", async () => {
    const admin = inviteAdmin()
    const { deps: d } = deps(admin, { "project_memberships.select": { count: 20 } })
    const result = await inviteMember(d, centreUser)
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/limit of 20 users/) })
    expect(admin.inviteByEmail).not.toHaveBeenCalled()
  })

  it("ignores the limit for projects without a tier", async () => {
    const { deps: d } = deps(inviteAdmin(), { "project_memberships.select": { count: 500 } }, null)
    expect((await inviteMember(d, centreUser)).ok).toBe(true)
  })

  it("deletes the new account if the membership cannot be added", async () => {
    const admin = inviteAdmin()
    const { deps: d } = deps(admin, {
      "project_memberships.insert": { error: { code: "P0001", message: "This project has reached its limit of 20 users." } },
    })
    const result = await inviteMember(d, centreUser)
    expect(result).toEqual({ ok: false, message: "This project has reached its limit of 20 users." })
    expect(admin.deleteUser).toHaveBeenCalledWith(NEW_USER)
  })

  it("never deletes an existing account, and explains a duplicate membership", async () => {
    const admin = inviteAdmin({ findUserIdByEmail: vi.fn(async () => "existing-id") })
    const { deps: d } = deps(admin, { "project_memberships.insert": { error: { code: "23505", message: "dup" } } })
    const result = await inviteMember(d, centreUser)
    expect(result).toEqual({ ok: false, message: "This person is already a member of this project." })
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it("requires an active centre of this project for centre users", async () => {
    const { deps: d } = deps(inviteAdmin(), { "centres.select": { data: null } })
    expect(await inviteMember(d, centreUser)).toEqual({ ok: false, message: "Choose an active centre in this project." })
  })

  it("validates the form", async () => {
    const { deps: d } = deps(inviteAdmin())
    expect(await inviteMember(d, { ...centreUser, email: "nope" })).toEqual({ ok: false, message: "Enter a valid email address." })
    expect(await inviteMember(d, { ...centreUser, centreId: "" })).toEqual({ ok: false, message: "Choose the user's centre." })
    expect(await inviteMember(d, { ...centreUser, fullName: " " })).toEqual({ ok: false, message: "Enter the user's name." })
  })

  it("explains when the service role key is missing", async () => {
    const { deps: d } = deps(null)
    expect((await inviteMember(d, centreUser)) as { message: string }).toMatchObject({
      ok: false,
      message: expect.stringMatching(/SUPABASE_SERVICE_ROLE_KEY/),
    })
  })
})

describe("changeMemberRole and removeMember", () => {
  it("updates the role scoped to the project", async () => {
    const fake = fakeSupabase({
      "centres.select": { data: { id: CENTRE } },
      "project_memberships.update": { data: { user_id: "u1" } },
    })
    const result = await changeMemberRole(fake.client, PROJECT, { membershipId: MEMBERSHIP, role: "centre_user", centreId: CENTRE })
    expect(result).toEqual({ ok: true, userId: "u1" })
    const update = fake.calls.find((c) => c.op === "update")
    expect(update?.args[0]).toEqual({ role: "centre_user", centre_id: CENTRE })
    expect(update?.filters).toEqual([
      ["eq:id", MEMBERSHIP],
      ["eq:project_id", PROJECT],
    ])
  })

  it("passes the last-admin guard's message through", async () => {
    const fake = fakeSupabase({
      "project_memberships.update": {
        error: { code: "P0001", message: "A project needs at least one project admin. Make someone else an admin first." },
      },
    })
    const result = await changeMemberRole(fake.client, PROJECT, { membershipId: MEMBERSHIP, role: "project_admin", centreId: "" })
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/at least one project admin/) })
  })

  it("reports a membership outside the project as not found", async () => {
    const fake = fakeSupabase({ "project_memberships.delete": { data: null } })
    expect(await removeMember(fake.client, PROJECT, MEMBERSHIP)).toEqual({ ok: false, message: "User not found in this project." })
    expect(await removeMember(fake.client, PROJECT, "bad")).toEqual({ ok: false, message: "Invalid user." })
  })
})

describe("listMembers", () => {
  it("marks invited users who have not signed in yet", async () => {
    const fake = fakeSupabase()
    const row = {
      membership_id: "m",
      user_id: "u",
      full_name: "A",
      email: "a@x.org",
      role: "centre_user",
      centre_id: CENTRE,
      centre_name: "C",
      added_at: "2026-10-01",
    }
    fake.rpc.mockResolvedValue({
      data: [
        { ...row, invited_at: "2026-10-01", last_sign_in_at: null },
        { ...row, membership_id: "m2", invited_at: "2026-10-01", last_sign_in_at: "2026-10-02" },
        { ...row, membership_id: "m3", invited_at: null, last_sign_in_at: null },
      ],
      error: null,
    })
    const members = await listMembers(fake.client, PROJECT)
    expect(fake.rpc).toHaveBeenCalledWith("project_member_directory", { p_project_id: PROJECT })
    expect(members.map((m) => m.invitePending)).toEqual([true, false, false])
  })
})
