import { afterEach, describe, expect, it, vi } from "vitest"
import { getSupabaseEnv } from "../lib/supabase/env"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getSupabaseEnv", () => {
  it("prefers the publishable key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    expect(getSupabaseEnv()).toEqual({
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_x",
    })
  })

  it("falls back to the legacy anon key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    expect(getSupabaseEnv().anonKey).toBe("anon-key")
  })

  it("throws when no key is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    expect(() => getSupabaseEnv()).toThrow(/Missing Supabase environment variables/)
  })
})
