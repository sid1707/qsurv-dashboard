import { z } from "zod"

/**
 * Only same-site paths are allowed after an invite, so a crafted link cannot
 * send someone to another site. "//host" and "/\host" are protocol-relative.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/projects") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
  return value
}

export const newPasswordInput = z
  .object({
    password: z
      .string()
      .min(10, "Password must be at least 10 characters.")
      .max(72, "Password must be 72 characters or fewer."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." })

/** The ways an invite link can arrive, depending on the Supabase email template. */
export type InviteLink =
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "token_hash"; tokenHash: string; type: string }
  | { kind: "code"; code: string }
  | { kind: "error"; message: string }

/**
 * Reads an invite landing URL. The default template sends tokens in the hash
 * (implicit flow); a customised template can send token_hash; PKCE sends code.
 */
export function parseInviteLink(href: string): InviteLink {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""))
  const query = url.searchParams

  const error = hash.get("error_description") ?? query.get("error_description")
  if (error) return { kind: "error", message: error.replace(/\+/g, " ") }

  const accessToken = hash.get("access_token")
  const refreshToken = hash.get("refresh_token")
  if (accessToken && refreshToken) return { kind: "session", accessToken, refreshToken }

  const tokenHash = query.get("token_hash")
  if (tokenHash) return { kind: "token_hash", tokenHash, type: query.get("type") ?? "invite" }

  const code = query.get("code")
  if (code) return { kind: "code", code }

  return { kind: "error", message: "This link is missing its sign-in details. Open the link from your invite email again." }
}
