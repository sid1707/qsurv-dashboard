import { beforeEach, describe, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}))

const loadUserContext = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}))

vi.mock("@/lib/auth/context", () => ({ loadUserContext }))

function userContext(overrides: { isSuperAdmin?: boolean; codes?: string[] } = {}) {
  return {
    userId: "u1",
    email: "a@b.org",
    fullName: "A",
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    projects: (overrides.codes ?? []).map((code) => ({
      projectId: `id-${code}`,
      code,
      title: code,
      status: "active",
      role: "centre_user",
      centreId: "c1",
      centreName: "C1",
    })),
  }
}

function signedIn() {
  auth.signInWithPassword.mockResolvedValue({ error: null })
  auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.org" } }, error: null })
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

import { signInWithPasswordAction } from "../app/login/actions"

const idle = { status: "idle" as const, message: "" }

function form(email: string, password: string) {
  const data = new FormData()
  data.set("email", email)
  data.set("password", password)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("signInWithPasswordAction", () => {
  it("requires email and password", async () => {
    const result = await signInWithPasswordAction(idle, form("  ", ""))
    expect(result).toEqual({ status: "error", message: "Email and password are required." })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it("normalizes the email before signing in", async () => {
    signedIn()
    loadUserContext.mockResolvedValue(userContext({ codes: ["P1", "P2"] }))
    await expect(
      signInWithPasswordAction(idle, form("  Lab@Example.ORG ", "secret"))
    ).rejects.toThrow("REDIRECT:")
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "lab@example.org",
      password: "secret",
    })
  })

  it.each([
    ["a super admin", userContext({ isSuperAdmin: true, codes: ["P1"] }), "/super-admin"],
    ["a centre user with one project", userContext({ codes: ["WW-DELHI"] }), "/p/WW-DELHI/centre"],
    ["a user with several projects", userContext({ codes: ["P1", "P2"] }), "/projects"],
  ])("redirects %s to the right home", async (_label, context, path) => {
    signedIn()
    loadUserContext.mockResolvedValue(context)
    await expect(signInWithPasswordAction(idle, form("a@b.org", "pw"))).rejects.toThrow(
      `REDIRECT:${path}`
    )
  })

  it("tells blocked (pending approval) accounts to wait for approval", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { code: "user_banned", message: "User is banned" },
    })
    const result = await signInWithPasswordAction(idle, form("a@b.org", "pw"))
    expect(result.status).toBe("error")
    expect(result.message).toMatch(/waiting for approval/)
  })

  it("signs out when the account has no profile", async () => {
    signedIn()
    loadUserContext.mockResolvedValue(null)
    const result = await signInWithPasswordAction(idle, form("a@b.org", "pw"))
    expect(result.status).toBe("error")
    expect(auth.signOut).toHaveBeenCalled()
  })

  it("maps invalid credentials to a friendly message", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    })
    const result = await signInWithPasswordAction(idle, form("a@b.org", "wrong"))
    expect(result).toEqual({ status: "error", message: "Invalid email or password." })
  })

  it("signs out when the session cannot be loaded", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null })
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const result = await signInWithPasswordAction(idle, form("a@b.org", "pw"))
    expect(result.status).toBe("error")
    expect(auth.signOut).toHaveBeenCalled()
  })
})
