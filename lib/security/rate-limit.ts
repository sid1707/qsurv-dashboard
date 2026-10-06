import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

type HeaderSource = Pick<Headers, "get">

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: HeaderSource) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown"
}

/** Hashed so raw IP addresses are never stored. */
export function hashRateLimitKey(value: string) {
  return createHash("sha256").update(`qsurv-rate-limit:${value}`).digest("hex")
}

/**
 * Records a hit in Postgres (shared across server instances). Returns false
 * when the caller is over the limit. Fails open if the store is unavailable,
 * so a database hiccup does not lock everyone out; the honeypot still applies.
 */
export async function consumeRateLimit(
  service: SupabaseClient,
  options: { bucket: string; keyHash: string; limit: number; windowSeconds: number }
) {
  const { data, error } = await service.rpc("consume_rate_limit", {
    p_bucket: options.bucket,
    p_key_hash: options.keyHash,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  })
  if (error) {
    console.error(`Rate limit check failed for ${options.bucket}: ${error.message}`)
    return true
  }
  return data === true
}
