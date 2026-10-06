import { describe, expect, it } from "vitest"
import { newPasswordInput, parseInviteLink, safeNextPath } from "../lib/auth/invite"

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/p/RBL-AMR")).toBe("/p/RBL-AMR")
  })

  it("falls back for other sites and protocol-relative paths", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "p/x", "", null]) {
      expect(safeNextPath(bad)).toBe("/projects")
    }
  })
})

describe("parseInviteLink", () => {
  const base = "https://qsurv.example/auth/accept?next=%2Fp%2FX"

  it("reads tokens from the hash (default Supabase invite template)", () => {
    expect(parseInviteLink(`${base}#access_token=a&refresh_token=r&type=invite`)).toEqual({
      kind: "session",
      accessToken: "a",
      refreshToken: "r",
    })
  })

  it("reads token_hash (custom template) and code (PKCE)", () => {
    expect(parseInviteLink(`${base}&token_hash=h&type=invite`)).toEqual({ kind: "token_hash", tokenHash: "h", type: "invite" })
    expect(parseInviteLink(`${base}&code=c`)).toEqual({ kind: "code", code: "c" })
  })

  it("surfaces Supabase errors, such as an expired link", () => {
    expect(parseInviteLink(`${base}#error=access_denied&error_description=Email+link+is+invalid+or+has+expired`)).toEqual({
      kind: "error",
      message: "Email link is invalid or has expired",
    })
  })

  it("explains a link with nothing in it", () => {
    expect(parseInviteLink(base).kind).toBe("error")
  })
})

describe("newPasswordInput", () => {
  it("matches the onboarding password rules", () => {
    expect(newPasswordInput.safeParse({ password: "short", confirmPassword: "short" }).success).toBe(false)
    expect(newPasswordInput.safeParse({ password: "long enough!", confirmPassword: "different!!" }).success).toBe(false)
    expect(newPasswordInput.safeParse({ password: "long enough!", confirmPassword: "long enough!" }).success).toBe(true)
  })
})
